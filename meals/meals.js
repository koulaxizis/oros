// ============================================================
// orOS Meal Planner — App logic (v1.0.0)
// Recipes, a weekly plan and the shopping list that comes out of it.
//   - Recipes: ingredients (one per line), steps, servings scaling,
//     diets with checks from the ingredients, favourites, cooking
//     mode (one step at a time, timers, screen kept on), "paste a
//     recipe", share, print; 8 ready recipes (EN/EL)
//   - Week: days × meals; recipes or free text; move, copy last week,
//     fill the gaps, clear (Undo)
//   - Shopping: computed from the week, quantities added up, by aisle,
//     pantry items left out; ticks and own items are synced
// The pure logic lives in core.js (OrosMealsCore).
// Data:
//   - synced slice "meals" (oros-meals-data): see core.js §9–10
//   - device-local (R10): oros-meals-prefs (tab, "fits us" filter,
//     "from today" switch)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage, prefs
//   3. Recipes: access + changes
//   4. Plan: changes
//   5. Shopping: changes
//   6. Render: tabs, recipes, week, shopping
//   7. Recipe view
//   8. Recipe editor + paste
//   9. Plan dialogs (picker, item, add to plan)
//  10. Cooking mode + timers
//  11. Settings + backup
//  12. Dialog helpers + toasts
//  13. Keyboard (Contract Β)
//  14. Sync slice + palette
//  15. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosMealsCore;
  var STORAGE_KEY = "oros-meals-data";
  var PREFS_KEY   = "oros-meals-prefs";

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
      "app.name": "Meal Planner", "tab.rc": "Recipes", "tab.wk": "Week", "tab.sh": "Shopping", "btn.settings": "Settings",
      "rc.search": "Search recipes, or ingredients with commas…", "rc.new": "New recipe", "rc.paste": "Paste",
      "rc.empty": "No recipes match.", "rc.none": "No recipes yet. Add one, or paste one from anywhere.",
      "rc.ingmode": "Recipes with: {list}", "f.fav": "★ Favourites", "f.fits": "Fits our diet",
      "rc.min": "{n} min", "rc.serv": "{n} serv.", "fav.add": "Add to favourites", "fav.del": "Remove from favourites",
      "wk.prev": "Previous week", "wk.next": "Next week", "wk.today": "This week",
      "wk.copy": "Copy last week", "wk.fill": "Fill the gaps", "wk.clear": "Clear week",
      "wk.add": "Add to {slot}, {day}", "wk.deleted": "Deleted recipe", "wk.nofit": "Does not fit our diet",
      "wk.copied": "{n} meals copied from last week", "wk.copiedNone": "Nothing to copy: last week is empty, or this week is full",
      "wk.filled": "{n} gaps filled", "wk.filledNone": "No gaps to fill, or no recipes to fill them with",
      "wk.cleared": "Week cleared", "wk.empty": "Nothing to clear",
      "slot.b": "Breakfast", "slot.l": "Lunch", "slot.d": "Dinner", "slot.s": "Snack", "slot.x": "Extra",
      "sh.from": "From today", "sh.copy": "Copy", "sh.share": "Share", "sh.todo": "To To-Do", "sh.todoNone": "Everything is ticked", "sh.uncheck": "Untick all",
      "sh.add": "Add an item…", "sh.count": "{n} items · {d} ticked", "sh.empty": "Nothing to buy. Plan some meals in the Week tab.",
      "sh.excluded": "Left out, you always have them:", "sh.restore": "Put {name} back on the list",
      "sh.title": "Shopping list {week}", "sh.more": "Options for {name}", "sh.aisle": "Aisle",
      "sh.pantry": "I always have it", "sh.remove": "Remove", "sh.from.recipes": "for {list}",
      "aisle.produce": "Fruit & vegetables", "aisle.meat": "Meat", "aisle.fish": "Fish & seafood", "aisle.dairy": "Dairy & eggs",
      "aisle.bakery": "Bakery", "aisle.pantry": "Cupboard", "aisle.spices": "Spices & herbs", "aisle.frozen": "Frozen",
      "aisle.drinks": "Drinks", "aisle.other": "Other",
      "course.": "No course", "course.breakfast": "Breakfast", "course.main": "Main", "course.side": "Side",
      "course.salad": "Salad", "course.soup": "Soup", "course.dessert": "Dessert", "course.snack": "Snack", "course.drink": "Drink",
      "diet.vegan": "Vegan", "diet.veg": "Vegetarian", "diet.pesc": "Pescatarian", "diet.raw": "Raw food",
      "diet.keto": "Keto", "diet.lowcarb": "Low-carb", "diet.gf": "Gluten-free", "diet.lf": "Lactose-free",
      "diet.nut": "Nut-free", "diet.fast": "Fasting (Lent)",
      "dshort.vegan": "Vegan", "dshort.veg": "Veg", "dshort.pesc": "Pesc", "dshort.raw": "Raw", "dshort.keto": "Keto",
      "dshort.lowcarb": "Low-carb", "dshort.gf": "GF", "dshort.lf": "LF", "dshort.nut": "No nuts", "dshort.fast": "Fasting",
      "diet.none": "Everything (no restrictions)",
      "warn.diet": "Marked {diet}, but has: {list}", "warn.cooked": "cooking time",
      "v.servings": "Servings", "v.prep": "Prep", "v.cook": "Cook", "v.ings": "Ingredients", "v.steps": "Steps",
      "v.notes": "Notes", "v.source": "Source", "v.cookmode": "Cook", "v.toplan": "Add to plan", "v.edit": "Edit",
      "v.share": "Share", "v.print": "Print", "v.dup": "Duplicate", "v.del": "Delete", "v.close": "Close",
      "v.less": "Fewer servings", "v.more": "More servings", "v.noings": "No ingredients.", "v.nosteps": "No steps.",
      "e.new": "New recipe", "e.edit": "Edit recipe", "e.title": "Title", "e.emoji": "Emoji", "e.course": "Course",
      "e.servings": "Servings", "e.prep": "Prep (min)", "e.cook": "Cook (min)", "e.diets": "Diets it fits",
      "e.suggest": "Suggest from the ingredients", "e.tags": "Tags (comma separated)",
      "e.ings": "Ingredients, one per line (\"200 g feta, crumbled\"; \"For the sauce:\" starts a group)",
      "e.steps": "Steps, one per line", "e.notes": "Notes", "e.src": "Source (book, link…)",
      "e.save": "Save", "e.cancel": "Cancel", "e.needTitle": "Give the recipe a title",
      "e.discard": "Discard your changes to this recipe?", "e.discardOk": "Discard", "e.keep": "Keep editing",
      "e.max": "Up to {n} recipes", "e.suggested": "Ticked what the ingredients allow. Check keto, low-carb and raw yourself.",
      "e.suggestNone": "Add ingredients first",
      "p.title": "Paste a recipe", "p.hint": "Paste a recipe from anywhere (a site, a message, a note). Ingredients and steps are found for you, then you check them before saving.",
      "p.go": "Continue", "p.empty": "Paste some text first",
      "pk.title": "{slot}, {day}", "pk.search": "Search recipes…", "pk.text": "Or write something (“Out”, “Leftovers”)",
      "pk.addText": "Add", "pk.fitsFirst": "Fit our diet first",
      "it.open": "Open recipe", "it.move": "Move to", "it.moveBtn": "Move", "it.remove": "Remove", "it.servings": "Servings",
      "ap.title": "Add to plan", "ap.day": "Day", "ap.slot": "Meal", "ap.add": "Add", "ap.added": "Added to {slot}, {day}",
      "ap.full": "That meal is full", "toast.undo": "Undo",
      "ck.step": "Step {n} of {m}", "ck.prev": "Previous step", "ck.next": "Next step", "ck.done": "Done",
      "ck.ings": "Ingredients", "ck.timer": "Timer {t}", "ck.timerEnd": "⏰ Time is up: {t}", "ck.timerStop": "Stop the {t} timer",
      "ck.awake": "Screen stays on",
      "s.title": "Settings", "s.diet": "Our diet", "s.dietHint": "Recipes that fit come first, and the week marks the ones that do not.",
      "s.slots": "Meals of the day", "s.week": "Week starts on", "s.mon": "Monday", "s.sun": "Sunday",
      "s.pantry": "Always in the house (left out of the shopping list)", "s.pantryAdd": "Add…",
      "s.pantryDel": "Remove {name}", "s.backup": "Backup", "s.export": "Export (JSON)", "s.import": "Import (JSON)",
      "s.close": "Close", "s.slotName": "Name for {slot}",
      "toast.saved": "Recipe saved", "toast.deleted": "“{t}” deleted", "toast.copied": "Copied",
      "toast.save": "Could not save: storage is full", "toast.imported": "Imported: {n} recipes", "toast.importBad": "That file is not a Meal Planner backup",
      "toast.exported": "Backup saved", "toast.nothing": "Nothing to share", "toast.removedItem": "Removed",
      "copy.suffix": "{t} (copy)", "share.serv": "{n} servings"
    },
    el: {
      "app.name": "Συνταγές & Μενού", "tab.rc": "Συνταγές", "tab.wk": "Εβδομάδα", "tab.sh": "Ψώνια", "btn.settings": "Ρυθμίσεις",
      "rc.search": "Αναζήτηση συνταγών, ή υλικά με κόμμα…", "rc.new": "Νέα συνταγή", "rc.paste": "Επικόλληση",
      "rc.empty": "Καμία συνταγή δεν ταιριάζει.", "rc.none": "Καμία συνταγή ακόμα. Πρόσθεσε μία, ή επικόλλησε από οπουδήποτε.",
      "rc.ingmode": "Συνταγές με: {list}", "f.fav": "★ Αγαπημένες", "f.fits": "Για τη διατροφή μας",
      "rc.min": "{n}′", "rc.serv": "{n} μερ.", "fav.add": "Στις αγαπημένες", "fav.del": "Αφαίρεση από τις αγαπημένες",
      "wk.prev": "Προηγούμενη εβδομάδα", "wk.next": "Επόμενη εβδομάδα", "wk.today": "Αυτή η εβδομάδα",
      "wk.copy": "Αντιγραφή προηγούμενης", "wk.fill": "Γέμισε τα κενά", "wk.clear": "Καθάρισμα",
      "wk.add": "Προσθήκη: {slot}, {day}", "wk.deleted": "Σβησμένη συνταγή", "wk.nofit": "Δεν ταιριάζει στη διατροφή μας",
      "wk.copied": "Αντιγράφηκαν {n} γεύματα από την προηγούμενη εβδομάδα", "wk.copiedNone": "Τίποτα για αντιγραφή: η προηγούμενη είναι άδεια ή αυτή γεμάτη",
      "wk.filled": "Γέμισαν {n} κενά", "wk.filledNone": "Δεν υπάρχουν κενά, ή συνταγές για να τα γεμίσουν",
      "wk.cleared": "Η εβδομάδα καθάρισε", "wk.empty": "Δεν υπάρχει κάτι να καθαρίσει",
      "slot.b": "Πρωινό", "slot.l": "Μεσημεριανό", "slot.d": "Βραδινό", "slot.s": "Σνακ", "slot.x": "Άλλο",
      "sh.from": "Από σήμερα", "sh.copy": "Αντιγραφή", "sh.share": "Μοίρασμα", "sh.todo": "Στο To-Do", "sh.todoNone": "Είναι όλα τσεκαρισμένα", "sh.uncheck": "Ξετσέκαρε όλα",
      "sh.add": "Πρόσθεσε είδος…", "sh.count": "{n} είδη · {d} τα πήρα", "sh.empty": "Τίποτα για ψώνια. Βάλε γεύματα στην Εβδομάδα.",
      "sh.excluded": "Δεν μπήκαν, τα έχεις πάντα:", "sh.restore": "Βάλε ξανά στη λίστα: {name}",
      "sh.title": "Λίστα για ψώνια {week}", "sh.more": "Επιλογές για: {name}", "sh.aisle": "Τμήμα",
      "sh.pantry": "Το έχω πάντα", "sh.remove": "Αφαίρεση", "sh.from.recipes": "για {list}",
      "aisle.produce": "Φρούτα & λαχανικά", "aisle.meat": "Κρέας", "aisle.fish": "Ψάρια & θαλασσινά", "aisle.dairy": "Γαλακτοκομικά & αυγά",
      "aisle.bakery": "Φούρνος", "aisle.pantry": "Ντουλάπι", "aisle.spices": "Μπαχαρικά & μυρωδικά", "aisle.frozen": "Κατεψυγμένα",
      "aisle.drinks": "Ποτά", "aisle.other": "Άλλα",
      "course.": "Χωρίς είδος", "course.breakfast": "Πρωινό", "course.main": "Κυρίως", "course.side": "Συνοδευτικό",
      "course.salad": "Σαλάτα", "course.soup": "Σούπα", "course.dessert": "Γλυκό", "course.snack": "Σνακ", "course.drink": "Ρόφημα",
      "diet.vegan": "Vegan", "diet.veg": "Χορτοφαγική", "diet.pesc": "Pescatarian (με ψάρι)", "diet.raw": "Ωμοφαγική",
      "diet.keto": "Keto", "diet.lowcarb": "Λίγοι υδατάνθρακες", "diet.gf": "Χωρίς γλουτένη", "diet.lf": "Χωρίς λακτόζη",
      "diet.nut": "Χωρίς ξηρούς καρπούς", "diet.fast": "Νηστίσιμο",
      "dshort.vegan": "Vegan", "dshort.veg": "Χορτοφ.", "dshort.pesc": "Pesc", "dshort.raw": "Ωμοφ.", "dshort.keto": "Keto",
      "dshort.lowcarb": "Low-carb", "dshort.gf": "Χ. γλουτένη", "dshort.lf": "Χ. λακτόζη", "dshort.nut": "Χ. ξηρούς", "dshort.fast": "Νηστίσιμο",
      "diet.none": "Τα τρώμε όλα (χωρίς περιορισμούς)",
      "warn.diet": "Είναι σημειωμένη {diet}, αλλά έχει: {list}", "warn.cooked": "χρόνο μαγειρέματος",
      "v.servings": "Μερίδες", "v.prep": "Προετοιμασία", "v.cook": "Μαγείρεμα", "v.ings": "Υλικά", "v.steps": "Εκτέλεση",
      "v.notes": "Σημειώσεις", "v.source": "Πηγή", "v.cookmode": "Μαγείρεμα", "v.toplan": "Στο πλάνο", "v.edit": "Επεξεργασία",
      "v.share": "Μοίρασμα", "v.print": "Εκτύπωση", "v.dup": "Αντίγραφο", "v.del": "Διαγραφή", "v.close": "Κλείσιμο",
      "v.less": "Λιγότερες μερίδες", "v.more": "Περισσότερες μερίδες", "v.noings": "Χωρίς υλικά.", "v.nosteps": "Χωρίς βήματα.",
      "e.new": "Νέα συνταγή", "e.edit": "Επεξεργασία συνταγής", "e.title": "Τίτλος", "e.emoji": "Emoji", "e.course": "Είδος",
      "e.servings": "Μερίδες", "e.prep": "Προετοιμασία (λεπτά)", "e.cook": "Μαγείρεμα (λεπτά)", "e.diets": "Διατροφές που ταιριάζει",
      "e.suggest": "Πρόταση από τα υλικά", "e.tags": "Ετικέτες (με κόμμα)",
      "e.ings": "Υλικά, ένα ανά γραμμή («200 γρ. φέτα, θρυμματισμένη»· το «Για τη σάλτσα:» ξεκινά ομάδα)",
      "e.steps": "Βήματα, ένα ανά γραμμή", "e.notes": "Σημειώσεις", "e.src": "Πηγή (βιβλίο, link…)",
      "e.save": "Αποθήκευση", "e.cancel": "Άκυρο", "e.needTitle": "Δώσε έναν τίτλο στη συνταγή",
      "e.discard": "Να χαθούν οι αλλαγές σου σε αυτή τη συνταγή;", "e.discardOk": "Να χαθούν", "e.keep": "Συνέχεια",
      "e.max": "Έως {n} συνταγές", "e.suggested": "Τσεκαρίστηκαν όσες επιτρέπουν τα υλικά. Το keto, τους λίγους υδατάνθρακες και την ωμοφαγία έλεγξέ τα εσύ.",
      "e.suggestNone": "Γράψε πρώτα τα υλικά",
      "p.title": "Επικόλληση συνταγής", "p.hint": "Επικόλλησε μια συνταγή από οπουδήποτε (site, μήνυμα, σημείωση). Τα υλικά και τα βήματα βρίσκονται μόνα τους και τα ελέγχεις πριν την αποθήκευση.",
      "p.go": "Συνέχεια", "p.empty": "Επικόλλησε πρώτα κείμενο",
      "pk.title": "{slot}, {day}", "pk.search": "Αναζήτηση συνταγών…", "pk.text": "Ή γράψε κάτι («Έξω», «Περισσεύματα»)",
      "pk.addText": "Προσθήκη", "pk.fitsFirst": "Πρώτα όσα ταιριάζουν στη διατροφή μας",
      "it.open": "Άνοιγμα συνταγής", "it.move": "Μετακίνηση σε", "it.moveBtn": "Μετακίνηση", "it.remove": "Αφαίρεση", "it.servings": "Μερίδες",
      "ap.title": "Στο πλάνο", "ap.day": "Ημέρα", "ap.slot": "Γεύμα", "ap.add": "Προσθήκη", "ap.added": "Μπήκε: {slot}, {day}",
      "ap.full": "Αυτό το γεύμα είναι γεμάτο", "toast.undo": "Αναίρεση",
      "ck.step": "Βήμα {n} από {m}", "ck.prev": "Προηγούμενο βήμα", "ck.next": "Επόμενο βήμα", "ck.done": "Τέλος",
      "ck.ings": "Υλικά", "ck.timer": "Χρονόμετρο {t}", "ck.timerEnd": "⏰ Τέλος χρόνου: {t}", "ck.timerStop": "Σταμάτα το χρονόμετρο {t}",
      "ck.awake": "Η οθόνη μένει ανοιχτή",
      "s.title": "Ρυθμίσεις", "s.diet": "Η διατροφή μας", "s.dietHint": "Οι συνταγές που ταιριάζουν έρχονται πρώτες, και η εβδομάδα σημειώνει όσες δεν ταιριάζουν.",
      "s.slots": "Γεύματα της ημέρας", "s.week": "Η εβδομάδα ξεκινά", "s.mon": "Δευτέρα", "s.sun": "Κυριακή",
      "s.pantry": "Υπάρχουν πάντα στο σπίτι (δεν μπαίνουν στη λίστα)", "s.pantryAdd": "Πρόσθεσε…",
      "s.pantryDel": "Αφαίρεση: {name}", "s.backup": "Αντίγραφο ασφαλείας", "s.export": "Εξαγωγή (JSON)", "s.import": "Εισαγωγή (JSON)",
      "s.close": "Κλείσιμο", "s.slotName": "Όνομα για: {slot}",
      "toast.saved": "Η συνταγή αποθηκεύτηκε", "toast.deleted": "Διαγράφηκε: «{t}»", "toast.copied": "Αντιγράφηκε",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.imported": "Εισήχθησαν: {n} συνταγές", "toast.importBad": "Αυτό το αρχείο δεν είναι αντίγραφο του Meal Planner",
      "toast.exported": "Το αντίγραφο αποθηκεύτηκε", "toast.nothing": "Τίποτα για μοίρασμα", "toast.removedItem": "Αφαιρέθηκε",
      "copy.suffix": "{t} (αντίγραφο)", "share.serv": "{n} μερίδες"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function newId(prefix) {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return (prefix || "") + Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function now() { return Date.now(); }
  function bump(m) { return Math.max(now(), (m || 0) + 1); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function slotName(s) { return (data.set.nm && data.set.nm[s]) || t("slot." + s); }
  function dietName(d) { return t("diet." + d); }

  var UI = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/></svg>'
  };

  // ---------- 2. Storage, prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.rc)) {
          data = C.mergeMeals(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] meals: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = C.emptyData();
  }

  var saveFailShown = false;
  // Canonical form, write, mark dirty. Called only on a user change.
  function commit() {
    data = C.mergeMeals(data, data);
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
      tab: ["rc", "wk", "sh"].indexOf(p.tab) >= 0 ? p.tab : "wk",
      fits: p.fits === 0 ? 0 : 1,
      from: p.from === 1 ? 1 : 0
    };
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  // View state (session only).
  var view = { wk: null, q: "", fav: false, course: "" };
  function today() { return C.localYmd(new Date()); }
  function thisWeek() { return C.weekStartOf(today(), data.set.ws); }

  // ---------- 3. Recipes ----------
  function storedRecipe(id) {
    for (var i = 0; i < data.rc.length; i++) if (data.rc[i].id === id) return data.rc[i];
    return null;
  }
  // A live recipe: stored, or a ready one that is neither stored nor deleted.
  function getRecipe(id) {
    var r = storedRecipe(id);
    if (r) return r;
    if (C.SEED_IDS.indexOf(id) >= 0 && !(id in data.tombs)) return C.seedRecipe(id, LANG);
    return null;
  }
  function recipes() { return C.allRecipes(data, LANG); }
  function sameContent(a, b) {
    var x = clone(a), y = clone(b);
    x.m = 0; y.m = 0;
    return JSON.stringify(x) === JSON.stringify(y);
  }
  // Store a recipe (new or changed). Returns the stored copy or null.
  function putRecipe(rec) {
    var cur = storedRecipe(rec.id) || getRecipe(rec.id);
    var x = C.normRecipe(Object.assign({}, rec, { m: 0 }));
    if (!x) return null;
    if (cur && sameContent(cur, x) && storedRecipe(rec.id)) return cur;   // R27: no change, no stamp
    x.m = bump(cur ? cur.m : 0);
    if (rec.id in data.tombs) x.m = Math.max(x.m, data.tombs[rec.id] + 1);
    data.rc = data.rc.filter(function (r) { return r.id !== rec.id; });
    data.rc.push(x);
    commit();
    return storedRecipe(rec.id);
  }
  function toggleFav(id) {
    var r = getRecipe(id);
    if (!r) return;
    var x = clone(r);
    x.fv = r.fv ? 0 : 1;
    putRecipe(x);
    renderRecipes();
  }
  function deleteRecipe(id) {
    var r = getRecipe(id);
    if (!r) return;
    var snap = clone(r);
    var ts = Math.max(now(), r.m);
    data.tombs[id] = Math.max(data.tombs[id] || 0, ts);
    data.rc = data.rc.filter(function (x) { return x.id !== id; });
    commit();
    renderAll();
    undoToast(t("toast.deleted", { t: snap.t }), function () {
      snap.m = (data.tombs[id] || 0) + 1;          // newer than the tomb: back to life (R17)
      data.rc = data.rc.filter(function (x) { return x.id !== id; });
      data.rc.push(snap);
      commit();
      renderAll();
    });
  }
  function duplicateRecipe(id) {
    var r = getRecipe(id);
    if (!r) return null;
    if (data.rc.length >= C.LIM.recipes) { showToast(t("e.max", { n: C.LIM.recipes })); return null; }
    var x = clone(r);
    x.id = newId("r");
    x.t = C.clean(t("copy.suffix", { t: r.t }), C.LIM.title);
    x.fv = 0;
    return putRecipe(x);
  }

  // ---------- 4. Plan ----------
  function cellKey(d, s) { return d + "|" + s; }
  function cellItems(k) { var c = data.pl[k]; return c ? clone(c.it) : []; }
  function setCellRaw(k, items) {
    var cur = data.pl[k];
    var before = cur ? JSON.stringify(cur.it) : "[]";
    var cell = C.normCell({ m: 1, it: items });
    if (JSON.stringify(cell.it) === before) return false;
    data.pl[k] = { m: bump(cur ? cur.m : 0), it: cell.it };
    return true;
  }
  function setCell(k, items) { if (setCellRaw(k, items)) { commit(); renderWeek(); renderShop(); } }
  // Several cells at once with one Undo.
  function batchCells(changes, msg) {
    var snap = {}, n = 0;
    Object.keys(changes).forEach(function (k) {
      var old = cellItems(k);
      if (setCellRaw(k, changes[k])) { snap[k] = old; n++; }
    });
    if (!n) return 0;
    commit();
    renderWeek(); renderShop();
    undoToast(msg.replace("{n}", n), function () {
      Object.keys(snap).forEach(function (k) { setCellRaw(k, snap[k]); });
      commit();
      renderWeek(); renderShop();
    });
    return n;
  }
  function addToCell(k, item) {
    var it = cellItems(k);
    if (it.length >= C.LIM.cellItems) { showToast(t("ap.full")); return false; }
    it.push(item);
    setCell(k, it);
    return true;
  }
  function weekCells(wk) {
    var keys = [];
    C.weekDays(wk).forEach(function (d) { data.set.sl.forEach(function (s) { keys.push(cellKey(d, s)); }); });
    return keys;
  }
  function copyLastWeek() {
    var ch = {};
    C.weekDays(view.wk).forEach(function (d) {
      var src = C.addDays(d, -7);
      data.set.sl.forEach(function (s) {
        var from = cellItems(cellKey(src, s)), k = cellKey(d, s);
        if (from.length && !cellItems(k).length) ch[k] = from;
      });
    });
    if (!batchCells(ch, t("wk.copied"))) showToast(t("wk.copiedNone"));
  }
  var FILL_COURSES = { b: ["breakfast"], l: ["main", "soup", "salad"], d: ["main", "soup", "salad"], s: ["snack", "dessert"], x: [] };
  function randInt(n) {
    var lim = Math.floor(4294967296 / n) * n, r = new Uint32Array(1);
    do { crypto.getRandomValues(r); } while (r[0] >= lim);
    return r[0] % n;
  }
  function fillGaps() {
    var all = recipes().filter(function (r) { return C.fits(r, data.set.dt); });
    var used = {};
    weekCells(view.wk).forEach(function (k) { cellItems(k).forEach(function (i) { if (i.r) used[i.r] = 1; }); });
    var ch = {};
    C.weekDays(view.wk).forEach(function (d) {
      data.set.sl.forEach(function (s) {
        var k = cellKey(d, s);
        if (cellItems(k).length || !FILL_COURSES[s].length) return;
        var pool = all.filter(function (r) { return FILL_COURSES[s].indexOf(r.c) >= 0; });
        var favs = pool.filter(function (r) { return r.fv; });
        if (favs.length >= 3) pool = favs;
        var fresh = pool.filter(function (r) { return !used[r.id]; });
        if (fresh.length) pool = fresh;
        if (!pool.length) return;
        var r = pool[randInt(pool.length)];
        used[r.id] = 1;
        ch[k] = [{ r: r.id, sv: r.sv }];
      });
    });
    if (!batchCells(ch, t("wk.filled"))) showToast(t("wk.filledNone"));
  }
  function clearWeek() {
    var ch = {};
    weekCells(view.wk).forEach(function (k) { if (cellItems(k).length) ch[k] = []; });
    if (!batchCells(ch, t("wk.cleared"))) showToast(t("wk.empty"));
  }

  // ---------- 5. Shopping ----------
  function shopList() { return C.buildShop(data, getRecipe, view.wk, prefs.from ? today() : null, LANG); }
  function setTick(item, on) {
    if (item.manual) {
      var x = null;
      data.mn.forEach(function (m) { if (m.id === item.key) x = m; });
      if (!x || x.d === (on ? 1 : 0)) return;
      x.d = on ? 1 : 0; x.m = bump(x.m);
    } else {
      var k = view.wk + "|" + item.key, cur = data.ck[k];
      if ((cur ? cur.v : 0) === (on ? 1 : 0)) return;
      data.ck[k] = { v: on ? 1 : 0, m: bump(cur ? cur.m : 0) };
    }
    commit();
  }
  function addManual(text) {
    var tx = C.clean(text, C.LIM.manual);
    if (!tx) return;
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    data.mn.push({ id: "n" + C.compactYmd(view.wk) + "-" + now().toString(36) + r[0].toString(36).slice(0, 4), m: now(), w: view.wk, t: tx, d: 0 });
    commit();
    renderShop();
  }
  function removeManual(id) {
    var x = null;
    data.mn.forEach(function (m) { if (m.id === id) x = m; });
    if (!x) return;
    var snap = clone(x);
    data.tombs[id] = Math.max(now(), x.m);
    data.mn = data.mn.filter(function (m) { return m.id !== id; });
    commit();
    renderShop();
    undoToast(t("toast.removedItem"), function () {
      snap.m = data.tombs[id] + 1;
      data.mn.push(snap);
      commit();
      renderShop();
    });
  }
  function setPantry(keys, on, name) {
    var changed = false;
    (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
      var cur = data.pn[k];
      if (C.inPantry(data, k) === on) return;   // (a ready pair flips with its first key)
      var x = { v: on ? 1 : 0, m: bump(cur ? cur.m : 0) };
      var n = C.clean(name || (cur && cur.n) || "", C.LIM.ingName);
      if (n) x.n = n;
      data.pn[k] = x;
      changed = true;
    });
    if (changed) commit();
  }
  function setAisle(k, a) {
    var cur = data.ai[k];
    if (cur && cur.a === a) return;
    data.ai[k] = { a: a, m: bump(cur ? cur.m : 0) };
    commit();
  }

  // ---------- 6. Render ----------
  function setTab(tab) {
    prefs.tab = tab;
    savePrefs();
    ["rc", "wk", "sh"].forEach(function (x) {
      var b = $("tab-" + x), on = x === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle("on", on);
      $("view-" + x).hidden = !on;
    });
  }

  function fmtDay(d, long) {
    var dt = new Date(d + "T12:00:00");
    var wd = new Intl.DateTimeFormat(LOCALE, { weekday: long ? "long" : "short" }).format(dt);
    return wd + " " + d.slice(8, 10) + "/" + d.slice(5, 7);
  }
  function weekLabel(wk) {
    var end = C.addDays(wk, 6);
    return wk.slice(8, 10) + "/" + wk.slice(5, 7) + " – " + end.slice(8, 10) + "/" + end.slice(5, 7);
  }

  // Recipes ----------------------------------------------------
  function ingTerms(q) {
    return q.split(",").map(function (s) { return C.keyOf(s); }).filter(Boolean);
  }
  function filteredRecipes() {
    var q = view.q.trim(), list = recipes();
    var terms = q.indexOf(",") >= 0 ? ingTerms(q) : null;
    var fq = C.fold(q);
    list = list.filter(function (r) {
      if (view.fav && !r.fv) return false;
      if (view.course && r.c !== view.course) return false;
      if (prefs.fits && data.set.dt.length && !C.fits(r, data.set.dt)) return false;
      if (terms) {
        var keys = r.ig.map(function (i) { return C.keyOf(i.n); }).join("|");
        return terms.every(function (k) { return keys.indexOf(k) >= 0; });
      }
      if (!fq) return true;
      var hay = C.fold([r.t].concat(r.tg, r.ig.map(function (i) { return i.n; })).join(" "));
      return hay.indexOf(fq) >= 0;
    });
    list.sort(function (a, b) {
      return (b.fv - a.fv) || C.fold(a.t).localeCompare(C.fold(b.t), LANG) || (a.id < b.id ? -1 : 1);
    });
    return list;
  }

  function renderFilters() {
    var box = $("rc-filters");
    box.innerHTML = "";
    function chip(label, on, fn) {
      var b = el("button", "chip" + (on ? " on" : ""), label);
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", fn);
      box.appendChild(b);
    }
    chip(t("f.fav"), view.fav, function () { view.fav = !view.fav; renderRecipes(); });
    if (data.set.dt.length) chip(t("f.fits"), !!prefs.fits, function () { prefs.fits = prefs.fits ? 0 : 1; savePrefs(); renderRecipes(); });
    var present = {};
    recipes().forEach(function (r) { if (r.c) present[r.c] = 1; });
    C.COURSES.forEach(function (c) {
      if (!present[c]) return;
      chip(t("course." + c), view.course === c, function () { view.course = view.course === c ? "" : c; renderRecipes(); });
    });
  }

  function dietBadges(r, max) {
    var box = el("span", "badges");
    var ds = r.dt.slice(0, max || 99);
    ds.forEach(function (d) {
      var b = el("span", "badge", t("dshort." + d));
      b.title = dietName(d);
      box.appendChild(b);
    });
    if (max && r.dt.length > max) box.appendChild(el("span", "badge more", "+" + (r.dt.length - max)));
    return box;
  }
  function recipeMeta(r) {
    var parts = [];
    var mins = r.pt + r.ct;
    if (mins) parts.push("⏱ " + t("rc.min", { n: mins }));
    parts.push(t("rc.serv", { n: r.sv }));
    return parts.join(" · ");
  }

  function renderRecipes() {
    renderFilters();
    var list = filteredRecipes(), box = $("rc-list");
    var q = view.q.trim();
    var terms = q.indexOf(",") >= 0 ? q.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : null;
    $("rc-ingmode").hidden = !terms;
    if (terms) $("rc-ingmode").textContent = t("rc.ingmode", { list: terms.join(", ") });
    box.innerHTML = "";
    list.forEach(function (r) {
      var card = el("div", "rc-card");
      var open = el("button", "rc-open");
      open.type = "button";
      open.appendChild(el("span", "rc-emoji", r.e || "🍽️"));
      var body = el("span", "rc-body");
      body.appendChild(el("span", "rc-title", r.t));
      body.appendChild(el("span", "rc-meta", (r.c ? t("course." + r.c) + " · " : "") + recipeMeta(r)));
      if (r.dt.length) body.appendChild(dietBadges(r, 3));
      open.appendChild(body);
      open.addEventListener("click", function () { openRecipe(r.id); });
      card.appendChild(open);
      var st = el("button", "mini star" + (r.fv ? " on" : ""));
      st.type = "button";
      st.innerHTML = r.fv ? UI.starOn : UI.star;
      st.setAttribute("aria-label", t(r.fv ? "fav.del" : "fav.add") + ": " + r.t);
      st.setAttribute("aria-pressed", r.fv ? "true" : "false");
      st.addEventListener("click", function () { toggleFav(r.id); });
      card.appendChild(st);
      box.appendChild(card);
    });
    var none = !recipes().length;
    $("rc-empty").hidden = list.length > 0;
    $("rc-empty").textContent = none ? t("rc.none") : t("rc.empty");
  }

  // Week ---------------------------------------------------------
  var drag = null;
  function renderWeekBars() {
    [].forEach.call(document.querySelectorAll(".wk-label"), function (n) { n.textContent = weekLabel(view.wk); });
    [].forEach.call(document.querySelectorAll(".wk-today"), function (n) { n.disabled = view.wk === thisWeek(); });
  }
  function renderWeek() {
    renderWeekBars();
    var box = $("wk-grid"), td = today();
    var scroll = box.scrollTop, scrollX = box.scrollLeft;
    box.innerHTML = "";
    box.style.setProperty("--slots", data.set.sl.length);
    C.weekDays(view.wk).forEach(function (d) {
      var day = el("section", "day" + (d === td ? " today" : ""));
      day.dataset.day = d;
      day.setAttribute("aria-label", fmtDay(d, true));
      day.appendChild(el("h3", "day-h", fmtDay(d)));
      data.set.sl.forEach(function (s) {
        var k = cellKey(d, s);
        var slot = el("div", "slot");
        slot.dataset.key = k;
        slot.appendChild(el("span", "slot-lbl", slotName(s)));
        var items = el("div", "slot-items");
        cellItems(k).forEach(function (it, idx) { items.appendChild(itemChip(k, it, idx)); });
        slot.appendChild(items);
        var add = el("button", "mini add");
        add.type = "button";
        add.innerHTML = UI.plus;
        add.setAttribute("aria-label", t("wk.add", { slot: slotName(s), day: fmtDay(d, true) }));
        add.addEventListener("click", function () { openPicker(k); });
        slot.appendChild(add);
        // Drag and drop between meals (mouse); touch and keyboard use "Move to".
        slot.addEventListener("dragover", function (e) { if (drag && drag.k !== k) { e.preventDefault(); slot.classList.add("drop"); } });
        slot.addEventListener("dragleave", function () { slot.classList.remove("drop"); });
        slot.addEventListener("drop", function (e) {
          e.preventDefault();
          slot.classList.remove("drop");
          if (drag && drag.k !== k) moveItem(drag.k, drag.idx, k);
          drag = null;
        });
        day.appendChild(slot);
      });
      box.appendChild(day);
    });
    box.scrollTop = scroll; box.scrollLeft = scrollX;
  }
  function itemLabel(it) {
    if (!it.r) return { e: "📝", t: it.t, gone: false, nofit: false };
    var r = getRecipe(it.r);
    if (!r) return { e: "🚫", t: t("wk.deleted"), gone: true, nofit: false };
    return { e: r.e || "🍽️", t: r.t, gone: false, nofit: data.set.dt.length > 0 && !C.fits(r, data.set.dt), sv: it.sv };
  }
  function itemChip(k, it, idx) {
    var L = itemLabel(it);
    var b = el("button", "item" + (L.gone ? " gone" : "") + (it.r ? "" : " text"));
    b.type = "button";
    b.appendChild(el("span", "it-e", L.e));
    b.appendChild(el("span", "it-t", L.t));
    if (L.sv) b.appendChild(el("span", "it-sv", "×" + L.sv));
    if (L.nofit) {
      var w = el("span", "it-warn", "⚠");
      w.title = t("wk.nofit");
      b.appendChild(w);
    }
    b.setAttribute("aria-label", L.t + (L.sv ? ", " + t("share.serv", { n: L.sv }) : "") + (L.nofit ? ", " + t("wk.nofit") : ""));
    b.addEventListener("click", function () { openItem(k, idx); });
    if (!coarse()) {
      b.draggable = true;
      b.addEventListener("dragstart", function (e) {
        drag = { k: k, idx: idx };
        try { e.dataTransfer.setData("text/plain", L.t); e.dataTransfer.effectAllowed = "move"; } catch (err) {}
      });
      b.addEventListener("dragend", function () { drag = null; });
    }
    return b;
  }
  function coarse() { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } }
  function moveItem(fromK, idx, toK) {
    var from = cellItems(fromK), to = cellItems(toK);
    if (!from[idx]) return;
    if (to.length >= C.LIM.cellItems) { showToast(t("ap.full")); return; }
    to.push(from.splice(idx, 1)[0]);
    setCellRaw(fromK, from);
    setCellRaw(toK, to);
    commit();
    renderWeek(); renderShop();
  }

  // Shopping -------------------------------------------------------
  function aisleName(a) { return t("aisle." + a); }
  function renderShop() {
    renderWeekBars();
    var fb = $("sh-from");
    fb.setAttribute("aria-pressed", prefs.from ? "true" : "false");
    fb.classList.toggle("on", !!prefs.from);
    var list = shopList(), box = $("sh-list");
    var scroll = $("view-sh").scrollTop;
    box.innerHTML = "";
    var aisle = null, ul = null;
    list.items.forEach(function (it) {
      if (it.aisle !== aisle) {
        aisle = it.aisle;
        box.appendChild(el("h3", "aisle-h", aisleName(aisle)));
        ul = el("ul", "shop");
        box.appendChild(ul);
      }
      var li = el("li", "sh-item" + (it.done ? " done" : ""));
      var lab = el("label", "sh-lab");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = it.done;
      cb.addEventListener("change", function () {
        setTick(it, cb.checked);
        li.classList.toggle("done", cb.checked);
        renderShopCount(shopList());
      });
      lab.appendChild(cb);
      var txt = el("span", "sh-txt");
      if (it.qty) txt.appendChild(el("b", "sh-qty", it.qty));
      txt.appendChild(el("span", "sh-name", it.name));
      if (it.from.length) txt.appendChild(el("span", "sh-from", t("sh.from.recipes", { list: it.from.join(", ") })));
      lab.appendChild(txt);
      li.appendChild(lab);
      var more = el("button", "mini");
      more.type = "button";
      more.innerHTML = UI.more;
      more.setAttribute("aria-label", t("sh.more", { name: it.name }));
      more.addEventListener("click", function () { openShopItem(it); });
      li.appendChild(more);
      ul.appendChild(li);
    });
    $("sh-empty").hidden = list.items.length > 0;
    $("sh-empty").textContent = t("sh.empty");
    renderShopCount(list);
    var ex = $("sh-excluded");
    ex.innerHTML = "";
    ex.hidden = !list.excluded.length;
    if (list.excluded.length) {
      ex.appendChild(el("span", "ex-lbl", t("sh.excluded")));
      list.excluded.forEach(function (x) {
        var b = el("button", "chip small", x.name);
        b.type = "button";
        b.setAttribute("aria-label", t("sh.restore", { name: x.name }));
        b.title = t("sh.restore", { name: x.name });
        b.addEventListener("click", function () { setPantry(x.key, false); renderShop(); });
        ex.appendChild(b);
      });
    }
    $("view-sh").scrollTop = scroll;
  }
  function renderShopCount(list) {
    var d = list.items.filter(function (i) { return i.done; }).length;
    $("sh-count").textContent = list.items.length ? t("sh.count", { n: list.items.length, d: d }) : "";
  }
  function shopTitle() { return t("sh.title", { week: weekLabel(view.wk) }); }
  function shopAsText() {
    var list = shopList();
    if (!list.items.length) return "";
    return shopTitle() + "\n\n" + C.shopText(list, aisleName, LANG);
  }

  // "To To-Do": the unticked items go to To-Do's Groceries list through
  // the shell (BR-TD-ADD). To-Do shows them and writes only on Add.
  function shellOpenAt() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenAt === "function" ? p : null;
    } catch (e) { return null; }
  }
  function sendToTodo() {
    var p = shellOpenAt();
    if (!p) return;
    var items = shopList().items.filter(function (it) { return !it.done; }).map(function (it) {
      return {
        text: (it.qty ? it.qty + " " : "") + it.name,
        note: it.from.length ? t("sh.from.recipes", { list: it.from.join(", ") }) : ""
      };
    });
    if (!items.length) { showToast(t("sh.todoNone")); return; }
    p.__orosOpenAt("todo", { addItems: { list: "tdl-groceries", from: t("app.name"), items: items.slice(0, 200) } });
  }

  function renderAll() {
    renderRecipes();
    renderWeek();
    renderShop();
  }

  // ---------- 7. Recipe view ----------
  function openRecipe(id, servings) {
    var r = getRecipe(id);
    if (!r) return;
    var sv = servings || r.sv;
    var dlg = makeDialog("ml-view", "wide");
    var head = el("div", "v-head");
    head.appendChild(el("span", "v-emoji", r.e || "🍽️"));
    var ht = el("h2", "v-title", r.t);
    ht.id = "ml-view-title";
    dlg.setAttribute("aria-labelledby", "ml-view-title");
    head.appendChild(ht);
    var st = el("button", "mini star" + (r.fv ? " on" : ""));
    st.type = "button";
    st.innerHTML = r.fv ? UI.starOn : UI.star;
    st.setAttribute("aria-label", t(r.fv ? "fav.del" : "fav.add"));
    st.addEventListener("click", function () { toggleFav(id); dlg.close(); openRecipe(id, sv); });
    head.appendChild(st);
    head.appendChild(closeBtn(dlg));
    dlg.appendChild(head);

    var meta = el("div", "v-meta");
    if (r.c) meta.appendChild(el("span", "pill", t("course." + r.c)));
    if (r.pt) meta.appendChild(el("span", "pill", t("v.prep") + " " + t("rc.min", { n: r.pt })));
    if (r.ct) meta.appendChild(el("span", "pill", t("v.cook") + " " + t("rc.min", { n: r.ct })));
    r.tg.forEach(function (g) { meta.appendChild(el("span", "pill tag", "#" + g)); });
    dlg.appendChild(meta);
    if (r.dt.length) dlg.appendChild(dietBadges(r));
    C.dietWarnings(r).forEach(function (w) {
      var names = w.ings.map(function (n) { return n === "*cooked" ? t("warn.cooked") : n; });
      dlg.appendChild(el("p", "warn", "⚠ " + t("warn.diet", { diet: dietName(w.d), list: names.join(", ") })));
    });

    // Servings
    var svRow = el("div", "sv-row");
    svRow.appendChild(el("span", "dlg-lbl inline", t("v.servings")));
    var svBox = stepper(sv, 1, C.LIM.servings, t("v.less"), t("v.more"), function (v) { sv = v; drawIngs(); });
    svRow.appendChild(svBox);
    dlg.appendChild(svRow);

    var cols = el("div", "v-cols");
    var left = el("div", "v-col");
    left.appendChild(el("h3", "sec-h", t("v.ings")));
    var ingBox = el("div", "");
    left.appendChild(ingBox);
    function drawIngs() {
      ingBox.innerHTML = "";
      if (!r.ig.length) { ingBox.appendChild(el("p", "hint", t("v.noings"))); return; }
      var g = null, ul = null;
      r.ig.forEach(function (ing) {
        if (ul === null || ing.g !== g) {
          g = ing.g;
          if (g) ingBox.appendChild(el("h4", "grp-h", g));
          ul = el("ul", "ings");
          ingBox.appendChild(ul);
        }
        var li = el("li", "");
        var lab = el("label", "ing-lab");
        var cb = el("input");
        cb.type = "checkbox";
        lab.appendChild(cb);
        var q = C.fmtIngQty(ing, LANG, sv / r.sv);
        var sp = el("span", "");
        if (q) sp.appendChild(el("b", "", q + " "));
        sp.appendChild(document.createTextNode(ing.n + (ing.x ? ", " + ing.x : "")));
        lab.appendChild(sp);
        li.appendChild(lab);
        ul.appendChild(li);
      });
    }
    drawIngs();
    cols.appendChild(left);
    var right = el("div", "v-col");
    right.appendChild(el("h3", "sec-h", t("v.steps")));
    if (r.st.length) {
      var ol = el("ol", "steps");
      r.st.forEach(function (s) { ol.appendChild(el("li", "", s)); });
      right.appendChild(ol);
    } else right.appendChild(el("p", "hint", t("v.nosteps")));
    if (r.no) {
      right.appendChild(el("h3", "sec-h", t("v.notes")));
      right.appendChild(el("p", "notes", r.no));
    }
    if (r.src) {
      right.appendChild(el("h3", "sec-h", t("v.source")));
      right.appendChild(sourceNode(r.src));
    }
    cols.appendChild(right);
    dlg.appendChild(cols);

    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("v.cookmode"), "primary", function () { dlg.close(); openCook(id, sv); }));
    acts.appendChild(button(t("v.toplan"), "", function () { dlg.close(); openAddToPlan(id, sv); }));
    acts.appendChild(button(t("v.edit"), "", function () { dlg.close(); openEditor(r); }));
    acts.appendChild(button(t("v.share"), "", function () { shareText(r.t, recipeText(r, sv)); }));
    acts.appendChild(button(t("v.print"), "", function () { printRecipe(r, sv); }));
    acts.appendChild(button(t("v.dup"), "", function () {
      var x = duplicateRecipe(id);
      if (x) { dlg.close(); renderAll(); openEditor(x); }
    }));
    acts.appendChild(button(t("v.del"), "danger", function () { dlg.close(); deleteRecipe(id); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  // A source: a real http(s) link opens in a new tab; anything else is text.
  function sourceNode(src) {
    var ok = false;
    try { var u = new URL(src); ok = u.protocol === "https:" || u.protocol === "http:"; } catch (e) {}
    if (!ok) return el("p", "notes", src);
    var a = el("a", "src-link", src);
    a.href = src;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function recipeText(r, sv) {
    var out = [(r.e ? r.e + " " : "") + r.t, t("share.serv", { n: sv }), ""];
    out.push(t("v.ings") + ":");
    var g = "";
    r.ig.forEach(function (ing) {
      if (ing.g && ing.g !== g) { g = ing.g; out.push(g + ":"); }
      out.push("- " + C.ingToLine(ing, LANG, sv / r.sv));
    });
    if (r.st.length) {
      out.push("", t("v.steps") + ":");
      r.st.forEach(function (s, i) { out.push((i + 1) + ". " + s); });
    }
    if (r.no) out.push("", r.no);
    if (r.src) out.push("", t("v.source") + ": " + r.src);
    return out.join("\n");
  }
  function shareText(title, text) {
    if (!text) { showToast(t("toast.nothing")); return; }
    try {
      if (navigator.share) {
        navigator.share({ title: title, text: text }).catch(function (e) {
          if (!e || e.name !== "AbortError") copyText(text);
        });
        return;
      }
    } catch (e) {}
    copyText(text);
  }
  function copyText(text) {
    if (!text) { showToast(t("toast.nothing")); return; }
    var done = function () { showToast(t("toast.copied")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text) && done(); });
        return;
      }
    } catch (e) {}
    if (legacyCopy(text)) done();
  }
  function legacyCopy(text) {
    var ta = el("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    (document.querySelector("dialog[open]") || document.body).appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }
  function printRecipe(r, sv) {
    var box = $("print-area");
    box.innerHTML = "";
    box.appendChild(el("h1", "", (r.e ? r.e + " " : "") + r.t));
    box.appendChild(el("p", "", t("share.serv", { n: sv }) + (r.pt + r.ct ? " · ⏱ " + t("rc.min", { n: r.pt + r.ct }) : "")));
    box.appendChild(el("h2", "", t("v.ings")));
    var ul = el("ul");
    r.ig.forEach(function (ing) { ul.appendChild(el("li", "", C.ingToLine(ing, LANG, sv / r.sv))); });
    box.appendChild(ul);
    box.appendChild(el("h2", "", t("v.steps")));
    var ol = el("ol");
    r.st.forEach(function (s) { ol.appendChild(el("li", "", s)); });
    box.appendChild(ol);
    if (r.no) { box.appendChild(el("h2", "", t("v.notes"))); box.appendChild(el("p", "", r.no)); }
    document.body.classList.add("printing");
    var openDlg = document.querySelector("dialog[open]");
    if (openDlg) openDlg.close();
    setTimeout(function () {
      try { window.print(); } catch (e) {}
      document.body.classList.remove("printing");
    }, 50);
  }

  // ---------- 8. Recipe editor + paste ----------
  // `rec`: an existing recipe, a draft (no id: new), or null.
  function openEditor(rec) {
    var isNew = !rec || !rec.id || !getRecipe(rec.id);
    if (isNew && data.rc.length >= C.LIM.recipes) { showToast(t("e.max", { n: C.LIM.recipes })); return; }
    var src = rec || {};
    var dlg = makeDialog("ml-edit", "wide");
    dlg.appendChild(el("div", "dlg-title", t(isNew ? "e.new" : "e.edit")));
    var form = el("form", "edit-form");
    form.method = "dialog";
    function field(label, input, cls) {
      var w = el("div", "fld" + (cls ? " " + cls : ""));
      var id = "ml-f-" + Math.random().toString(36).slice(2, 8);
      var l = el("label", "dlg-lbl", label);
      l.setAttribute("for", id);
      input.id = id;
      w.appendChild(l); w.appendChild(input);
      return w;
    }
    function input(type, value, max) {
      var i = el("input");
      i.type = type;
      if (max) i.maxLength = max;
      i.value = value === undefined || value === null ? "" : value;
      i.autocomplete = "off";
      return i;
    }
    function num(value, lo, hi) {
      var i = input("number", value);
      i.min = lo; i.max = hi; i.step = 1; i.inputMode = "numeric";
      return i;
    }
    function area(value, rows, max) {
      var a = el("textarea");
      a.rows = rows; a.maxLength = max;
      a.value = value || "";
      return a;
    }
    var fTitle = input("text", src.t, C.LIM.title);
    var fEmoji = input("text", src.e || "", C.LIM.emoji);
    var fCourse = el("select");
    [""].concat(C.COURSES).forEach(function (c) {
      var o = el("option", "", t("course." + c));
      o.value = c;
      if ((src.c || "") === c) o.selected = true;
      fCourse.appendChild(o);
    });
    var fSv = num(src.sv || 4, 1, C.LIM.servings);
    var fPt = num(src.pt || "", 0, C.LIM.minutes);
    var fCt = num(src.ct || "", 0, C.LIM.minutes);
    var row1 = el("div", "fld-row");
    row1.appendChild(field(t("e.title"), fTitle, "grow"));
    row1.appendChild(field(t("e.emoji"), fEmoji, "narrow"));
    form.appendChild(row1);
    var row2 = el("div", "fld-row");
    row2.appendChild(field(t("e.course"), fCourse));
    row2.appendChild(field(t("e.servings"), fSv, "narrow"));
    row2.appendChild(field(t("e.prep"), fPt, "narrow"));
    row2.appendChild(field(t("e.cook"), fCt, "narrow"));
    form.appendChild(row2);

    var fIngs = area(src.ig ? C.ingsToText(src.ig, LANG) : "", 8, 8000);
    form.appendChild(field(t("e.ings"), fIngs));
    var fSteps = area((src.st || []).join("\n"), 7, 20000);
    form.appendChild(field(t("e.steps"), fSteps));

    // Diets
    var dset = el("fieldset", "diets");
    dset.appendChild(el("legend", "dlg-lbl", t("e.diets")));
    var dBoxes = {};
    var dGrid = el("div", "check-grid");
    C.DIETS.forEach(function (d) {
      var l = el("label", "check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = (src.dt || []).indexOf(d) >= 0;
      cb.addEventListener("change", drawWarn);
      dBoxes[d] = cb;
      l.appendChild(cb);
      l.appendChild(el("span", "", dietName(d)));
      dGrid.appendChild(l);
    });
    dset.appendChild(dGrid);
    var sug = button(t("e.suggest"), "small", function () {
      var draft = gather();
      if (!draft.ig.length) { showToast(t("e.suggestNone")); return; }
      var s = C.suggestDiets(draft);
      C.DIETS.forEach(function (d) {
        if (d === "keto" || d === "lowcarb" || d === "raw") return;
        dBoxes[d].checked = s.indexOf(d) >= 0;
      });
      drawWarn();
      showToast(t("e.suggested"));
    });
    dset.appendChild(sug);
    var warnBox = el("div", "warns");
    dset.appendChild(warnBox);
    form.appendChild(dset);
    fIngs.addEventListener("input", debounce(drawWarn, 400));
    fCt.addEventListener("input", drawWarn);

    var fTags = input("text", (src.tg || []).join(", "), 300);
    form.appendChild(field(t("e.tags"), fTags));
    var fNotes = area(src.no || "", 3, C.LIM.notes);
    form.appendChild(field(t("e.notes"), fNotes));
    var fSrc = input("text", src.src || "", C.LIM.src);
    form.appendChild(field(t("e.src"), fSrc));

    function gather() {
      return {
        t: C.clean(fTitle.value, C.LIM.title),
        e: C.clean(fEmoji.value, C.LIM.emoji),
        c: fCourse.value,
        sv: Number(fSv.value) || 4, pt: Number(fPt.value) || 0, ct: Number(fCt.value) || 0,
        dt: C.DIETS.filter(function (d) { return dBoxes[d].checked; }),
        tg: fTags.value.split(","),
        ig: C.textToIngs(fIngs.value),
        st: C.textToSteps(fSteps.value),
        no: fNotes.value, src: fSrc.value,
        fv: src.fv === 1 ? 1 : 0
      };
    }
    function drawWarn() {
      warnBox.innerHTML = "";
      var draft = C.normRecipe(Object.assign({ id: "draft-x", m: 0 }, gather(), { t: "x" }));
      if (!draft) return;
      C.dietWarnings(draft).forEach(function (w) {
        var names = w.ings.map(function (n) { return n === "*cooked" ? t("warn.cooked") : n; });
        warnBox.appendChild(el("p", "warn", "⚠ " + t("warn.diet", { diet: dietName(w.d), list: names.join(", ") })));
      });
    }
    drawWarn();
    var startSnap = JSON.stringify(gather());

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("e.cancel"), "", function () { tryClose(); }));
    var ok = button(t("e.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    function tryClose() {
      if (JSON.stringify(gather()) === startSnap) { dlg.close(); return; }
      confirmDialog(t("e.discard"), t("e.discardOk"), t("e.keep"), function () { dlg.close(); });
    }
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); tryClose(); });
    dlg._backdropClose = tryClose;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var g = gather();
      if (!g.t) { showToast(t("e.needTitle")); fTitle.focus(); return; }
      var id = isNew ? newId("r") : src.id;
      var saved = putRecipe(Object.assign({ id: id }, g));
      if (!saved) return;
      dlg.close();
      renderAll();
      showToast(t("toast.saved"));
      openRecipe(id);
    });
    dlg.appendChild(form);
    showDialog(dlg);
    if (isNew) fTitle.focus();
  }
  function debounce(fn, ms) {
    var tm = null;
    return function () { clearTimeout(tm); tm = setTimeout(fn, ms); };
  }

  function openPaste() {
    var dlg = makeDialog("ml-paste");
    dlg.appendChild(el("div", "dlg-title", t("p.title")));
    dlg.appendChild(el("p", "hint", t("p.hint")));
    var ta = el("textarea", "paste-in");
    ta.rows = 12;
    ta.maxLength = 30000;
    ta.setAttribute("aria-label", t("p.title"));
    dlg.appendChild(ta);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("e.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("p.go"), "primary", function () {
      if (!ta.value.trim()) { showToast(t("p.empty")); ta.focus(); return; }
      var d = C.parseRecipeText(ta.value);
      dlg.close();
      openEditor({ t: d.t, sv: d.sv || 4, pt: d.pt || 0, ct: d.ct || 0, ig: d.ig, st: d.st, no: d.no, dt: [], tg: [] });
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
    ta.focus();
  }

  // ---------- 9. Plan dialogs ----------
  function splitKey(k) { return { d: k.slice(0, 10), s: k.slice(11) }; }
  function openPicker(k) {
    var p = splitKey(k);
    var dlg = makeDialog("ml-pick");
    dlg.appendChild(el("div", "dlg-title", t("pk.title", { slot: slotName(p.s), day: fmtDay(p.d, true) })));
    var q = el("input");
    q.type = "search";
    q.placeholder = t("pk.search");
    q.setAttribute("aria-label", t("pk.search"));
    q.autocomplete = "off";
    dlg.appendChild(q);
    var list = el("div", "pick-list");
    dlg.appendChild(list);
    var course = FILL_COURSES[p.s] || [];
    function draw() {
      list.innerHTML = "";
      var fq = C.fold(q.value.trim());
      var all = recipes().filter(function (r) { return !fq || C.fold(r.t + " " + r.tg.join(" ")).indexOf(fq) >= 0; });
      var dt = data.set.dt;
      all.sort(function (a, b) {
        var fa = C.fits(a, dt) ? 1 : 0, fb = C.fits(b, dt) ? 1 : 0;
        var ca = course.indexOf(a.c) >= 0 ? 1 : 0, cb = course.indexOf(b.c) >= 0 ? 1 : 0;
        return (fb - fa) || (b.fv - a.fv) || (cb - ca) || C.fold(a.t).localeCompare(C.fold(b.t), LANG);
      });
      all.forEach(function (r) {
        var b = el("button", "pick-row");
        b.type = "button";
        b.appendChild(el("span", "rc-emoji small", r.e || "🍽️"));
        var body = el("span", "rc-body");
        body.appendChild(el("span", "rc-title", (r.fv ? "★ " : "") + r.t));
        body.appendChild(el("span", "rc-meta", recipeMeta(r)));
        b.appendChild(body);
        if (dt.length && !C.fits(r, dt)) {
          var w = el("span", "it-warn", "⚠");
          w.title = t("wk.nofit");
          b.appendChild(w);
          b.setAttribute("aria-label", r.t + ", " + t("wk.nofit"));
        }
        b.addEventListener("click", function () {
          if (addToCell(k, { r: r.id, sv: r.sv })) dlg.close();
        });
        list.appendChild(b);
      });
    }
    q.addEventListener("input", draw);
    draw();
    var row = el("div", "add-row");
    var tx = el("input");
    tx.maxLength = C.LIM.cellText;
    tx.placeholder = t("pk.text");
    tx.setAttribute("aria-label", t("pk.text"));
    tx.autocomplete = "off";
    var addTx = function () {
      var v = C.clean(tx.value, C.LIM.cellText);
      if (!v) { tx.focus(); return; }
      if (addToCell(k, { t: v })) dlg.close();
    };
    tx.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addTx(); } });
    row.appendChild(tx);
    row.appendChild(button(t("pk.addText"), "", addTx));
    dlg.appendChild(row);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("v.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
    if (!coarse()) q.focus();
  }

  function daySlotSelects(defDay, defSlot, days) {
    var sd = el("select"), ss = el("select");
    days.forEach(function (d) {
      var o = el("option", "", fmtDay(d, true));
      o.value = d;
      if (d === defDay) o.selected = true;
      sd.appendChild(o);
    });
    data.set.sl.forEach(function (s) {
      var o = el("option", "", slotName(s));
      o.value = s;
      if (s === defSlot) o.selected = true;
      ss.appendChild(o);
    });
    return { day: sd, slot: ss };
  }
  function labeled(label, node) {
    var w = el("div", "fld");
    var id = "ml-s-" + Math.random().toString(36).slice(2, 8);
    var l = el("label", "dlg-lbl", label);
    l.setAttribute("for", id);
    node.id = id;
    w.appendChild(l); w.appendChild(node);
    return w;
  }

  function openItem(k, idx) {
    var it = cellItems(k)[idx];
    if (!it) return;
    var L = itemLabel(it), p = splitKey(k);
    var dlg = makeDialog("ml-item");
    dlg.appendChild(el("div", "dlg-title", slotName(p.s) + ", " + fmtDay(p.d, true)));
    dlg.appendChild(el("p", "item-name", L.e + " " + L.t));
    if (L.nofit) dlg.appendChild(el("p", "warn", "⚠ " + t("wk.nofit")));
    if (it.r && !L.gone) {
      var svRow = el("div", "sv-row");
      svRow.appendChild(el("span", "dlg-lbl inline", t("it.servings")));
      svRow.appendChild(stepper(it.sv, 1, C.LIM.servings, t("v.less"), t("v.more"), function (v) {
        var items = cellItems(k);
        if (!items[idx]) return;
        items[idx].sv = v;
        setCell(k, items);
      }));
      dlg.appendChild(svRow);
    }
    // Move: this week and the next.
    var days = C.weekDays(view.wk).concat(C.weekDays(C.addDays(view.wk, 7)));
    var sel = daySlotSelects(p.d, p.s, days);
    var mv = el("div", "fld-row");
    mv.appendChild(labeled(t("ap.day"), sel.day));
    mv.appendChild(labeled(t("ap.slot"), sel.slot));
    var mvSec = el("fieldset", "move");
    mvSec.appendChild(el("legend", "dlg-lbl", t("it.move")));
    mvSec.appendChild(mv);
    mvSec.appendChild(button(t("it.moveBtn"), "small", function () {
      var to = cellKey(sel.day.value, sel.slot.value);
      if (to === k) { dlg.close(); return; }
      dlg.close();
      moveItem(k, idx, to);
    }));
    dlg.appendChild(mvSec);
    var acts = el("div", "dlg-actions wrap");
    if (it.r && !L.gone) acts.appendChild(button(t("it.open"), "primary", function () { dlg.close(); openRecipe(it.r, it.sv); }));
    acts.appendChild(button(t("it.remove"), "danger", function () {
      var items = cellItems(k), old = cellItems(k);
      items.splice(idx, 1);
      dlg.close();
      setCell(k, items);
      undoToast(t("toast.removedItem"), function () { setCell(k, old); });
    }));
    acts.appendChild(button(t("v.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function openAddToPlan(id, sv) {
    var r = getRecipe(id);
    if (!r) return;
    var td = today(), wk = C.weekStartOf(td, data.set.ws);
    var days = C.weekDays(wk).concat(C.weekDays(C.addDays(wk, 7))).filter(function (d) { return d >= td; });
    var defSlot = data.set.sl.indexOf("d") >= 0 ? "d" : data.set.sl[data.set.sl.length - 1];
    if (r.c === "breakfast" && data.set.sl.indexOf("b") >= 0) defSlot = "b";
    var dlg = makeDialog("ml-addplan");
    dlg.appendChild(el("div", "dlg-title", t("ap.title")));
    dlg.appendChild(el("p", "item-name", (r.e || "🍽️") + " " + r.t));
    var sel = daySlotSelects(td, defSlot, days);
    var row = el("div", "fld-row");
    row.appendChild(labeled(t("ap.day"), sel.day));
    row.appendChild(labeled(t("ap.slot"), sel.slot));
    dlg.appendChild(row);
    var svRow = el("div", "sv-row");
    svRow.appendChild(el("span", "dlg-lbl inline", t("v.servings")));
    svRow.appendChild(stepper(sv || r.sv, 1, C.LIM.servings, t("v.less"), t("v.more"), function (v) { sv = v; }));
    dlg.appendChild(svRow);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("e.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ap.add"), "primary", function () {
      var d = sel.day.value, s = sel.slot.value;
      if (addToCell(cellKey(d, s), { r: id, sv: sv || r.sv })) {
        dlg.close();
        showToast(t("ap.added", { slot: slotName(s), day: fmtDay(d, true) }));
      }
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function openShopItem(it) {
    var dlg = makeDialog("ml-shop");
    dlg.appendChild(el("div", "dlg-title", it.name));
    var k = it.manual ? C.keyOf(it.name) : it.key;
    var sa = el("select");
    C.AISLES.forEach(function (a) {
      var o = el("option", "", aisleName(a));
      o.value = a;
      if (a === it.aisle) o.selected = true;
      sa.appendChild(o);
    });
    sa.addEventListener("change", function () { setAisle(k, sa.value); renderShop(); });
    dlg.appendChild(labeled(t("sh.aisle"), sa));
    var acts = el("div", "dlg-actions wrap");
    if (it.manual) {
      acts.appendChild(button(t("sh.remove"), "danger", function () { dlg.close(); removeManual(it.key); }));
    } else {
      acts.appendChild(button(t("sh.pantry"), "", function () { dlg.close(); setPantry(k, true, it.name); renderShop(); }));
    }
    acts.appendChild(button(t("v.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function stepper(value, lo, hi, lessLbl, moreLbl, onChange) {
    var box = el("span", "stepper");
    var v = value;
    var minus = el("button", "mini");
    minus.type = "button"; minus.innerHTML = UI.minus; minus.setAttribute("aria-label", lessLbl);
    var out = el("output", "step-v", String(v));
    out.setAttribute("aria-live", "polite");
    var plus = el("button", "mini");
    plus.type = "button"; plus.innerHTML = UI.plus; plus.setAttribute("aria-label", moreLbl);
    function set(n) {
      n = Math.max(lo, Math.min(hi, n));
      if (n === v) return;
      v = n; out.textContent = String(v);
      minus.disabled = v <= lo; plus.disabled = v >= hi;
      onChange(v);
    }
    minus.disabled = v <= lo; plus.disabled = v >= hi;
    minus.addEventListener("click", function () { set(v - 1); });
    plus.addEventListener("click", function () { set(v + 1); });
    box.appendChild(minus); box.appendChild(out); box.appendChild(plus);
    return box;
  }

  // ---------- 10. Cooking mode + timers ----------
  var wakeLock = null;
  function keepAwake(on) {
    try {
      if (on && navigator.wakeLock && !wakeLock) {
        navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; }, function () {});
      } else if (!on && wakeLock) {
        wakeLock.release().catch(function () {});
        wakeLock = null;
      }
    } catch (e) {}
  }
  function openCook(id, sv) {
    var r = getRecipe(id);
    if (!r) return;
    var steps = r.st.length ? r.st : [t("v.nosteps")];
    var i = 0;
    var dlg = makeDialog("ml-cook", "cook");
    var head = el("div", "v-head");
    head.appendChild(el("span", "v-emoji", r.e || "🍽️"));
    head.appendChild(el("h2", "v-title", r.t));
    head.appendChild(closeBtn(dlg));
    dlg.appendChild(head);
    var ingT = el("details", "ck-ings");
    ingT.appendChild(el("summary", "", t("ck.ings") + " · " + t("share.serv", { n: sv })));
    var ul = el("ul", "ings");
    r.ig.forEach(function (ing) {
      var li = el("li", "");
      var lab = el("label", "ing-lab");
      var cb = el("input"); cb.type = "checkbox";
      lab.appendChild(cb);
      lab.appendChild(el("span", "", C.ingToLine(ing, LANG, sv / r.sv)));
      li.appendChild(lab);
      ul.appendChild(li);
    });
    ingT.appendChild(ul);
    dlg.appendChild(ingT);
    var count = el("div", "ck-count");
    var text = el("p", "ck-step");
    text.setAttribute("aria-live", "polite");
    var tbox = el("div", "ck-timers");
    dlg.appendChild(count);
    dlg.appendChild(text);
    dlg.appendChild(tbox);
    var nav = el("div", "ck-nav");
    var prev = button("", "", function () { go(-1); });
    prev.innerHTML = UI.left; prev.setAttribute("aria-label", t("ck.prev"));
    var next = button("", "primary", function () { if (i >= steps.length - 1) dlg.close(); else go(1); });
    nav.appendChild(prev); nav.appendChild(next);
    dlg.appendChild(nav);
    dlg.appendChild(el("p", "hint center", t("ck.awake")));
    function draw() {
      count.textContent = t("ck.step", { n: i + 1, m: steps.length });
      text.textContent = steps[i];
      prev.disabled = i === 0;
      if (i >= steps.length - 1) { next.textContent = t("ck.done"); next.removeAttribute("aria-label"); }
      else { next.innerHTML = UI.right; next.setAttribute("aria-label", t("ck.next")); }
      tbox.innerHTML = "";
      C.stepTimers(steps[i]).forEach(function (mins) {
        var b = button("", "small", function () { startTimer(mins, r.t); });
        b.innerHTML = UI.timer + "<span></span>";
        b.lastChild.textContent = t("ck.timer", { t: fmtMins(mins) });
        tbox.appendChild(b);
      });
    }
    function go(d) { i = Math.max(0, Math.min(steps.length - 1, i + d)); draw(); }
    dlg.addEventListener("keydown", function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT|SUMMARY/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    });
    dlg.addEventListener("close", function () { keepAwake(false); });
    document.addEventListener("visibilitychange", function re() {
      if (!dlg.isConnected) { document.removeEventListener("visibilitychange", re); return; }
      if (document.visibilityState === "visible" && dlg.open) { wakeLock = null; keepAwake(true); }
    });
    draw();
    showDialog(dlg);
    keepAwake(true);
    next.focus();
  }
  function fmtMins(m) {
    if (m < 60) return t("rc.min", { n: m });
    var h = Math.floor(m / 60), r = m % 60;
    return h + (LANG === "el" ? " ώρ." : " h") + (r ? " " + t("rc.min", { n: r }) : "");
  }
  // Timers live in this frame only (a page reload forgets them).
  var timers = [], timerTick = null;
  function startTimer(mins, title) {
    timers.push({ id: newId("t"), end: now() + mins * 60000, mins: mins, title: title });
    drawTimers();
    if (!timerTick) timerTick = setInterval(drawTimers, 1000);
  }
  function drawTimers() {
    var box = $("timers"), n = now();
    timers.forEach(function (tm) {
      if (!tm.rang && n >= tm.end) { tm.rang = true; ring(tm); }
    });
    timers = timers.filter(function (tm) { return !tm.rang || n - tm.end < 60000; });
    box.innerHTML = "";
    box.hidden = !timers.length;
    if (!timers.length) { clearInterval(timerTick); timerTick = null; return; }
    hostTimers();
    timers.forEach(function (tm) {
      var left = Math.max(0, Math.round((tm.end - n) / 1000));
      var b = el("button", "timer" + (tm.rang ? " rang" : ""));
      b.type = "button";
      b.textContent = "⏱ " + Math.floor(left / 60) + ":" + ("0" + left % 60).slice(-2) + " · " + tm.title;
      b.setAttribute("aria-label", t("ck.timerStop", { t: fmtMins(tm.mins) }));
      b.addEventListener("click", function () {
        timers = timers.filter(function (x) { return x.id !== tm.id; });
        drawTimers();
      });
      box.appendChild(b);
    });
  }
  function hostTimers() {
    var box = $("timers"), d = document.querySelector("dialog[open]");
    var host = d || document.body;
    if (box.parentNode !== host) host.appendChild(box);
  }
  var actx = null;
  function ring(tm) {
    showToast(t("ck.timerEnd", { t: fmtMins(tm.mins) + " · " + tm.title }));
    live(t("ck.timerEnd", { t: fmtMins(tm.mins) }));
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      [0, 0.45, 0.9].forEach(function (at) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, actx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.3, actx.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + at + 0.35);
        o.connect(g); g.connect(actx.destination);
        o.start(actx.currentTime + at); o.stop(actx.currentTime + at + 0.4);
      });
    } catch (e) {}
  }

  // ---------- 11. Settings + backup ----------
  function changeSet(fn) {
    var next = clone(data.set);
    fn(next);
    next = C.normSet(Object.assign(next, { m: 1 }));
    var cur = clone(data.set);
    cur.m = 1;
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    next.m = bump(data.set.m);
    data.set = next;
    commit();
  }
  function openSettings() {
    var dlg = makeDialog("ml-set", "wide");
    var head = el("div", "v-head");
    head.appendChild(el("h2", "v-title", t("s.title")));
    head.appendChild(closeBtn(dlg));
    dlg.appendChild(head);

    var diet = el("fieldset", "diets");
    diet.appendChild(el("legend", "dlg-lbl", t("s.diet")));
    diet.appendChild(el("p", "hint", t("s.dietHint")));
    var grid = el("div", "check-grid");
    var dNone = el("p", "hint", t("diet.none"));
    C.DIETS.forEach(function (d) {
      var l = el("label", "check");
      var cb = el("input"); cb.type = "checkbox";
      cb.checked = data.set.dt.indexOf(d) >= 0;
      cb.addEventListener("change", function () {
        changeSet(function (s) {
          s.dt = s.dt.filter(function (x) { return x !== d; });
          if (cb.checked) s.dt.push(d);
        });
        dNone.hidden = data.set.dt.length > 0;
        renderAll();
      });
      l.appendChild(cb); l.appendChild(el("span", "", dietName(d)));
      grid.appendChild(l);
    });
    diet.appendChild(grid);
    dNone.hidden = data.set.dt.length > 0;
    diet.appendChild(dNone);
    dlg.appendChild(diet);

    var slots = el("fieldset", "");
    slots.appendChild(el("legend", "dlg-lbl", t("s.slots")));
    C.SLOT_IDS.forEach(function (s) {
      var row = el("div", "slot-set");
      var l = el("label", "check");
      var cb = el("input"); cb.type = "checkbox";
      cb.checked = data.set.sl.indexOf(s) >= 0;
      l.appendChild(cb); l.appendChild(el("span", "", t("slot." + s)));
      var nm = el("input");
      nm.maxLength = C.LIM.slotName;
      nm.value = (data.set.nm && data.set.nm[s]) || "";
      nm.placeholder = t("slot." + s);
      nm.setAttribute("aria-label", t("s.slotName", { slot: t("slot." + s) }));
      nm.autocomplete = "off";
      cb.addEventListener("change", function () {
        changeSet(function (st) {
          var on = C.SLOT_IDS.filter(function (x) { return x === s ? cb.checked : st.sl.indexOf(x) >= 0; });
          st.sl = on;
        });
        cb.checked = data.set.sl.indexOf(s) >= 0;   // the last one cannot go
        renderAll();
      });
      nm.addEventListener("change", function () {
        changeSet(function (st) { st.nm = Object.assign({}, st.nm); st.nm[s] = nm.value; });
        renderAll();
      });
      row.appendChild(l); row.appendChild(nm);
      slots.appendChild(row);
    });
    dlg.appendChild(slots);

    var ws = el("fieldset", "");
    ws.appendChild(el("legend", "dlg-lbl", t("s.week")));
    var wsRow = el("div", "check-grid");
    [[1, "s.mon"], [0, "s.sun"]].forEach(function (o) {
      var l = el("label", "check");
      var rb = el("input"); rb.type = "radio"; rb.name = "ml-ws";
      rb.checked = data.set.ws === o[0];
      rb.addEventListener("change", function () {
        if (!rb.checked) return;
        changeSet(function (s) { s.ws = o[0]; });
        view.wk = C.weekStartOf(view.wk, data.set.ws);
        renderAll();
      });
      l.appendChild(rb); l.appendChild(el("span", "", t(o[1])));
      wsRow.appendChild(l);
    });
    ws.appendChild(wsRow);
    dlg.appendChild(ws);

    var pan = el("fieldset", "");
    pan.appendChild(el("legend", "dlg-lbl", t("s.pantry")));
    var chips = el("div", "chips");
    function drawPantry() {
      chips.innerHTML = "";
      C.pantryList(data, LANG).forEach(function (p) {
        var b = el("button", "chip small", p.name + " ×");
        b.type = "button";
        b.setAttribute("aria-label", t("s.pantryDel", { name: p.name }));
        b.addEventListener("click", function () { setPantry(p.keys, false); drawPantry(); renderShop(); });
        chips.appendChild(b);
      });
    }
    drawPantry();
    pan.appendChild(chips);
    var prow = el("div", "add-row");
    var pin = el("input");
    pin.placeholder = t("s.pantryAdd");
    pin.setAttribute("aria-label", t("s.pantryAdd"));
    pin.maxLength = 60;
    pin.autocomplete = "off";
    var padd = function () {
      var k = C.keyOf(pin.value);
      if (!k) return;
      setPantry(k, true, pin.value);
      pin.value = "";
      drawPantry(); renderShop();
    };
    pin.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); padd(); } });
    var pb = el("button", "icon-btn");
    pb.type = "button"; pb.innerHTML = UI.plus; pb.setAttribute("aria-label", t("s.pantryAdd"));
    pb.addEventListener("click", padd);
    prow.appendChild(pin); prow.appendChild(pb);
    pan.appendChild(prow);
    dlg.appendChild(pan);

    var bk = el("fieldset", "");
    bk.appendChild(el("legend", "dlg-lbl", t("s.backup")));
    var brow = el("div", "dlg-actions wrap");
    brow.appendChild(button(t("s.export"), "", exportBackup));
    brow.appendChild(button(t("s.import"), "", importBackup));
    bk.appendChild(brow);
    dlg.appendChild(bk);
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
  function exportBackup() {
    var payload = { app: "oros-meals", ver: C.DATA_VER, exported: new Date().toISOString(), data: C.mergeMeals(data, data) };
    var text = JSON.stringify(payload, null, 1);
    var name = "orOS-meals-" + today() + ".json";
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ text: text, filename: name, mime: "application/json",
                     types: [{ description: "JSON", accept: { "application/json": [".json"] } }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var blob = new Blob([text], { type: "application/json" });
    var a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
  }
  function importBackup() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function" ? host.openFile(".json,application/json") : localPickFile(".json,application/json");
    Promise.resolve(pick).then(function (file) {
      if (!file) return null;
      return file.text();
    }).then(function (text) {
      if (text === null || text === undefined) return;
      var obj = null;
      try { obj = JSON.parse(text); } catch (e) {}
      var inc = obj && obj.app === "oros-meals" && obj.data ? obj.data : obj;
      if (!inc || typeof inc !== "object" || !Array.isArray(inc.rc)) { showToast(t("toast.importBad")); return; }
      var before = {};
      data.rc.forEach(function (r) { before[r.id] = 1; });
      data = C.mergeMeals(data, inc);           // merge, never a wipe
      var added = data.rc.filter(function (r) { return !before[r.id]; }).length;
      commit();
      renderAll();
      showToast(t("toast.imported", { n: added }));
    }).catch(function () { showToast(t("toast.importBad")); });
  }

  // ---------- 12. Dialog helpers + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function closeBtn(dlg) {
    var b = el("button", "mini");
    b.type = "button";
    b.innerHTML = UI.close;
    b.setAttribute("aria-label", t("v.close"));
    b.addEventListener("click", function () { if (dlg._backdropClose) dlg._backdropClose(); else dlg.close(); });
    return b;
  }
  function makeDialog(id, cls) {
    var stale = document.getElementById(id);
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg" + (cls ? " " + cls : "");
    dlg.addEventListener("click", function (e) {
      if (e.target !== dlg) return;
      if (dlg._backdropClose) dlg._backdropClose(); else dlg.close();
    });
    dlg.addEventListener("close", function () {
      parkToast();
      parkTimers();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function showDialog(dlg) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (timers.length) hostTimers();
  }
  function parkTimers() {
    var box = $("timers");
    setTimeout(function () {
      var d = document.querySelector("dialog[open]");
      var host = d || document.body;
      if (box && box.parentNode !== host) host.appendChild(box);
    }, 0);
  }
  function confirmDialog(msg, okLabel, cancelLabel, onOk) {
    var dlg = makeDialog("ml-confirm");
    dlg.appendChild(el("p", "confirm-msg", msg));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(cancelLabel, "", function () { dlg.close(); }));
    acts.appendChild(button(okLabel, "danger", function () { dlg.close(); onOk(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
    acts.firstChild.focus();
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "meals", title: String(text) })) return;
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
    setTimeout(function () {
      var d = document.querySelector("dialog[open]");
      var host = d || document.body;
      if (box && box.parentNode !== host) host.appendChild(box);
    }, 0);
  }
  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 13. Keyboard ----------
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
    // App keys: 1/2/3 tabs, N new recipe, / search, ← → week.
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if (e.code === "Digit1") setTab("rc");
      else if (e.code === "Digit2") setTab("wk");
      else if (e.code === "Digit3") setTab("sh");
      else if (e.code === "KeyN") { e.preventDefault(); openEditor(null); }
      else if (e.code === "Slash") { e.preventDefault(); setTab("rc"); $("rc-search").focus(); }
      else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && prefs.tab !== "rc" && tag !== "BUTTON") {
        e.preventDefault(); shiftWeek(e.code === "ArrowLeft" ? -1 : 1);
      } else return;
    });
    // Tabs: arrow keys move between them (ARIA tabs pattern).
    $("tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      var order = ["rc", "wk", "sh"], i = order.indexOf(prefs.tab);
      i = (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
      setTab(order[i]);
      $("tab-" + order[i]).focus();
    });
  }
  function shiftWeek(n) {
    view.wk = n === 0 ? thisWeek() : C.addDays(view.wk, 7 * n);
    renderWeek();
    renderShop();
  }

  // ---------- 14. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
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
    api.registerSlice("meals", sliceGet, sliceSet, STORAGE_KEY, C.mergeMeals);
  }
  function sliceGet() { return C.mergeMeals(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.rc)) return;
    var before = JSON.stringify(data);
    var wsWas = data.set.ws;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeMeals(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    if (data.set.ws !== wsWas) view.wk = C.weekStartOf(view.wk, data.set.ws);
    // Open dialogs (editor, recipe, settings) are left alone: what the
    // user is typing stays (SS-4). The views behind them repaint.
    renderAll();
  }

  // ---------- 15. Wiring & boot ----------
  function applyI18n() {
    document.title = (LANG === "el" ? "Συνταγές & Μενού" : "Meal Planner") + " · orOS";
    ["rc", "wk", "sh"].forEach(function (x) { $("tab-" + x).textContent = t("tab." + x); });
    var sb = $("set-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    $("tabs").setAttribute("aria-label", LANG === "el" ? "Ενότητες" : "Sections");
    $("rc-search").placeholder = t("rc.search");
    $("rc-search").setAttribute("aria-label", t("rc.search"));
    $("rc-new").innerHTML = UI.plus + "<span></span>";
    $("rc-new").lastChild.textContent = t("rc.new");
    $("rc-new").setAttribute("aria-label", t("rc.new"));
    $("rc-paste").innerHTML = UI.paste + "<span></span>";
    $("rc-paste").lastChild.textContent = t("rc.paste");
    $("rc-paste").setAttribute("aria-label", t("p.title"));
    [].forEach.call(document.querySelectorAll(".wk-prev"), function (b) { b.innerHTML = UI.left; b.setAttribute("aria-label", t("wk.prev")); b.title = t("wk.prev"); });
    [].forEach.call(document.querySelectorAll(".wk-next"), function (b) { b.innerHTML = UI.right; b.setAttribute("aria-label", t("wk.next")); b.title = t("wk.next"); });
    [].forEach.call(document.querySelectorAll(".wk-today"), function (b) { b.textContent = t("wk.today"); });
    $("wk-copy").textContent = t("wk.copy");
    $("wk-fill").textContent = t("wk.fill");
    $("wk-clear").textContent = t("wk.clear");
    $("sh-from").textContent = t("sh.from");
    $("sh-copy").textContent = t("sh.copy");
    $("sh-share").textContent = t("sh.share");
    $("sh-todo").textContent = t("sh.todo");
    $("sh-uncheck").textContent = t("sh.uncheck");
    $("sh-add-in").placeholder = t("sh.add");
    $("sh-add-in").setAttribute("aria-label", t("sh.add"));
    $("sh-add-btn").innerHTML = UI.plus;
    $("sh-add-btn").setAttribute("aria-label", t("sh.add"));
  }

  function wire() {
    ["rc", "wk", "sh"].forEach(function (x) {
      $("tab-" + x).addEventListener("click", function () { setTab(x); });
    });
    $("set-btn").addEventListener("click", openSettings);
    $("rc-search").addEventListener("input", function () { view.q = $("rc-search").value; renderRecipes(); });
    $("rc-new").addEventListener("click", function () { openEditor(null); });
    $("rc-paste").addEventListener("click", openPaste);
    [].forEach.call(document.querySelectorAll(".wk-prev"), function (b) { b.addEventListener("click", function () { shiftWeek(-1); }); });
    [].forEach.call(document.querySelectorAll(".wk-next"), function (b) { b.addEventListener("click", function () { shiftWeek(1); }); });
    [].forEach.call(document.querySelectorAll(".wk-today"), function (b) { b.addEventListener("click", function () { shiftWeek(0); }); });
    $("wk-copy").addEventListener("click", copyLastWeek);
    $("wk-fill").addEventListener("click", fillGaps);
    $("wk-clear").addEventListener("click", clearWeek);
    $("sh-from").addEventListener("click", function () { prefs.from = prefs.from ? 0 : 1; savePrefs(); renderShop(); });
    $("sh-copy").addEventListener("click", function () { copyText(shopAsText()); });
    $("sh-share").addEventListener("click", function () { shareText(shopTitle(), shopAsText()); });
    $("sh-todo").hidden = !shellOpenAt();
    $("sh-todo").addEventListener("click", sendToTodo);
    $("sh-uncheck").addEventListener("click", function () {
      shopList().items.forEach(function (it) { if (it.done) setTick(it, false); });
      renderShop();
    });
    var addIn = $("sh-add-in");
    var add = function () { addManual(addIn.value); addIn.value = ""; addIn.focus(); };
    $("sh-add-btn").addEventListener("click", add);
    addIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } });
    // A new day (the app left open overnight): this week moves on.
    var lastDay = today();
    setInterval(function () {
      var d = today();
      if (d === lastDay) return;
      var wasThis = view.wk === C.weekStartOf(lastDay, data.set.ws);
      lastDay = d;
      if (wasThis) view.wk = thisWeek();
      renderWeek(); renderShop();
    }, 60000);
    window.addEventListener("pagehide", function () {
      keepAwake(false);
      try { if (actx) actx.close(); } catch (e) {}
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    view.wk = thisWeek();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    setTab(prefs.tab);
    renderAll();
    scrollToToday();
    window.__orosOpenAt = openTarget;
    takeTarget();
  }
  // Deep link (shell __orosOpenAt / __orosTakeTarget): { day: "YYYY-MM-DD" }
  // from a Calendar row opens the Week tab at that day. A dialog in
  // progress wins (no jump); anything else is ignored.
  function openTarget(tg) {
    if (!tg || !C.validYmd(tg.day) || document.querySelector("dialog[open]")) return;
    view.wk = C.weekStartOf(tg.day, data.set.ws);
    setTab("wk");
    renderAll();
    var d = document.querySelector('#wk-grid .day[data-day="' + tg.day + '"]');
    if (d && d.scrollIntoView) d.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function takeTarget() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var tg = p.__orosTakeTarget("meals");
        if (tg) openTarget(tg);
      }
    } catch (e) {}
  }

  // Phone: the week is a column of days; open it at today.
  function scrollToToday() {
    if (prefs.tab !== "wk" || window.innerWidth > 760) return;
    var d = document.querySelector("#wk-grid .day.today");
    if (d) $("view-wk").scrollTop = d.offsetTop - $("view-wk").offsetTop - 8;
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("meals.js v" + (m ? m[1] : "?") + " boot");
  })();

  boot();
})();
