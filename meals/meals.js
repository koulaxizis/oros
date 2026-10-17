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
//   - Wave 2: import from a web address (JSON-LD, through the Reader's
//     network layer and the orOS relay), pasted page source / JSON, or
//     Paprika / Mealie / Tandoor files (import.js, loaded on demand);
//     wave 6 adds Mela, Recipe Keeper, Nextcloud Cookbook, Cooklang,
//     Crouton and MyCookbook, and a batch import (stable ids, one
//     write, Undo);
//     servings and units (as written / metric / US, per device) in the
//     recipe and in cooking mode; a Household section
//   - Wave 3: a Pantry tab (what is at home: amount, fridge / freezer /
//     cupboard, best-before; add by text, from ticked shopping lines or
//     by barcode via Open Food Facts), "What can I cook?", "Cooked"
//     takes a recipe's ingredients from the pantry (preview first), the
//     shopping list sets aside what the pantry covers, nutrition per
//     serving and per day (built-in USDA table + Open Food Facts)
// The pure logic lives in core.js (OrosMealsCore), import.js
// (OrosMealsImport), nutrition.js (OrosMealsNutrition) and pantry.js
// (OrosMealsPantry).
// Data:
//   - synced slice "meals" (oros-meals-data): see core.js §9–10
//   - device-local (R10): oros-meals-prefs (tab, "fits us" filter,
//     "from today" switch, units shown, nutrition shown, best-before
//     reminder hour (read by the shell), pantry filter)
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
//  10b. Pantry, barcode, what can I cook, cooked, nutrition
//  11. Settings + backup
//  12. Dialog helpers + toasts
//  13. Keyboard (Contract Β)
//  14. Sync slice + palette
//  15. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosMealsCore;
  var N = window.OrosMealsNutrition;
  var P = window.OrosMealsPantry;
  var STORAGE_KEY = "oros-meals-data";
  var PREFS_KEY   = "oros-meals-prefs";
  var TABS = ["rc", "wk", "sh", "pa"];

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
      "rc.search": "Search recipes, or ingredients with commas…", "rc.new": "New recipe", "rc.paste": "Import",
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
      "sheet.open": "Open in Spreadsheet", "sheet.cap": "Only the first {n} rows fit in one sheet",
      "sheet.weekNone": "Nothing planned this week", "sheet.shopNone": "Nothing to buy this week",
      "bud.btn": "Add to Budget", "bud.title": "How much did you pay?", "bud.amt": "Amount",
      "bud.bad": "Type an amount above zero, e.g. 12,50", "bud.note": "Shopping: {n} items",
      "bud.go": "Continue in Budget", "bud.fail": "Budget couldn't open this", "bud.none": "The list is empty",
      "sheet.date": "Date", "sheet.day": "Day", "sheet.meal": "Meal", "sheet.dish": "Dish", "sheet.serv": "Servings",
      "sheet.item": "Item", "sheet.qty": "Quantity", "sheet.for": "For", "sheet.done": "Bought",
      "aisle.produce": "Fruit & vegetables", "aisle.meat": "Meat", "aisle.fish": "Fish & seafood", "aisle.dairy": "Dairy & eggs",
      "aisle.bakery": "Bakery", "aisle.pantry": "Cupboard", "aisle.spices": "Spices & herbs", "aisle.frozen": "Frozen",
      "aisle.drinks": "Drinks", "aisle.household": "Household", "aisle.other": "Other",
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
      "p.title": "Import a recipe", "p.hint": "Or paste a recipe from anywhere: text from a site, a message or a note, or a page's source (HTML) or JSON. Ingredients and steps are found for you, then you check them before saving.",
      "p.go": "Continue", "p.empty": "Type a web address, or paste some text first", "p.paste": "Paste the recipe",
      "im.url": "Web address of a recipe", "im.fetch": "Fetch",
      "im.urlHint": "Works with most recipe sites. Sites that don't let apps read them go through the orOS relay set up in Mail or Reader.",
      "im.file": "Open a file…", "im.fileHint": "Exports from Paprika, Mela, Recipe Keeper, Crouton, MyCookbook, Mealie, Tandoor or Nextcloud Cookbook, Cooklang (.cook) files, a saved page (.html) or JSON.",
      "im.loading": "Fetching the page…", "im.reading": "Reading the file…",
      "im.none": "No recipe found there. Copy the recipe's text and paste it below.",
      "im.noneFile": "No recipes found in this file.", "im.badUrl": "Type a web address (https://…)",
      "im.err.offline": "You are offline.",
      "im.err.norelay": "This site doesn't let apps read it. Set up the orOS relay in Mail, or open the page, copy the recipe and paste it below.",
      "im.err.status": "The site answered with an error ({n}).",
      "im.err.other": "Could not read the page ({code}). Copy the recipe and paste it below.",
      "im.err.file": "Could not read this file.",
      "im.many": "{n} recipes found", "im.manyHint": "Tick the ones to add. Ones you already have (same title) start unticked.",
      "im.have": "already in your recipes", "im.add": "Add {n}", "im.all": "All", "im.noneSel": "None",
      "im.from": "From {src}", "im.sum": "{n} recipes", "im.sumHave": "{n} recipes, {k} already imported",
      "im.stored": "already imported", "im.counts": "{i} ingredients, {s} steps",
      "im.photos": "Photos are not brought in; a web link to a photo is kept.",
      "v.photo": "Photo (opens the site)",
      "un.label": "Units", "un.": "As written", "un.metric": "Metric", "un.us": "US",
      "s.units": "Units on this device", "s.unitsHint": "Recipes, cooking mode and the shopping list show quantities and oven temperatures in these units.",
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
      "s.file": "Save and open", "file.save": "orOS file (.orosmeals)", "file.open": "Open orOS file…",
      "file.copy": "Open as copy…", "file.folder": "Unzipped orOS folder…",
      "file.copyHint": "“Open as copy” adds the file's recipes as new ones, even recipes you already have.",
      "s.close": "Close", "s.slotName": "Name for {slot}",
      "toast.saved": "Recipe saved", "toast.deleted": "“{t}” deleted", "toast.copied": "Copied",
      "toast.save": "Could not save: storage is full", "toast.imported": "Imported: {n} recipes", "toast.importBad": "That file is not a Meal Planner backup",
      "toast.exported": "Backup saved", "toast.nothing": "Nothing to share", "toast.removedItem": "Removed",
      "copy.suffix": "{t} (copy)", "share.serv": "{n} servings",
      "tab.pa": "Pantry", "loc.fridge": "Fridge", "loc.freezer": "Freezer", "loc.cupboard": "Cupboard", "loc.all": "All",
      "pa.add": "Add: “1 l milk”, “6 eggs”…", "pa.addBtn": "Add to the pantry", "pa.scan": "Barcode", "pa.cook": "What can I cook?",
      "pa.empty": "Nothing in the pantry yet. Add what you have at home, scan a barcode, or tick items in Shopping.",
      "pa.emptyLoc": "Nothing here.", "pa.soon": "Use soon", "pa.bbIn": "best before {d}", "pa.today": "best before today",
      "pa.tomorrow": "best before tomorrow", "pa.days": "{n} days left", "pa.expired": "past its date ({d})",
      "pa.some": "some", "pa.edit": "Edit {name}", "pa.added": "Added to the pantry: {name}", "pa.more": "Added {name}: now {q}",
      "pa.removed": "Removed from the pantry", "pa.max": "Up to {n} items in the pantry",
      "pe.new": "Add to the pantry", "pe.edit": "Pantry item", "pe.name": "Name", "pe.qty": "Quantity", "pe.unit": "Unit",
      "pe.loc": "Kept in", "pe.bb": "Best before", "pe.bc": "Barcode", "pe.save": "Save", "pe.del": "Remove",
      "pe.needName": "Give it a name",
      "u.pc": "pieces", "u.": "—",
      "bc.title": "Add by barcode", "bc.code": "Barcode number", "bc.look": "Look up", "bc.cam": "Point the camera at the barcode",
      "bc.camOff": "The camera can't be used here. Type the number under the barcode.", "bc.bad": "That number doesn't look like a barcode (8, 12, 13 or 14 digits).",
      "bc.looking": "Looking it up on Open Food Facts…", "bc.notFound": "Not on Open Food Facts. You can still add it by name.",
      "bc.known": "You already have this: {name}", "bc.add": "Add to the pantry", "bc.addName": "Add it by name",
      "bc.per100": "per 100 g: {k} kcal · protein {p} g · carbs {c} g · fat {f} g", "bc.page": "See it on Open Food Facts",
      "net.offline": "You are offline.", "net.err": "Open Food Facts could not be reached ({code}). Try again later.",
      "ck.title": "What can I cook?", "ck.hint": "Recipes by how much of them is already at home. Things you always have count as there.",
      "ck.none": "No recipe uses what is in the pantry yet.", "ck.have": "{h} of {n} at home", "ck.all": "Everything is at home",
      "ck.missing": "Missing: {list}", "ck.low": "Not enough: {list}", "ck.soonUse": "uses something to eat soon",
      "ck.addMissing": "Add missing to the list", "ck.addedMissing": "{n} added to this week's shopping list", "ck.open": "Open",
      "co.btn": "Cooked", "co.title": "Cooked: take from the pantry", "co.hint": "Untick what you didn't use. Nothing changes until you press Take from the pantry.",
      "co.line": "{take} of {have} → {left} left", "co.gone": "{take}: used up", "co.usedUp": "Used up (remove {name})",
      "co.short": "{n} more than the pantry had", "co.notIn": "Not in the pantry", "co.ok": "Take from the pantry",
      "co.done": "Pantry updated", "co.nothing": "Nothing of this recipe is in the pantry.",
      "sh.home": "At home already (pantry):", "sh.homeHint": "In the pantry in enough quantity: not counted, copied or sent.",
      "sh.have": "at home: {q}", "sh.toPantry": "To pantry", "sh.bought": "Ticked: {name}", "sh.tickedToPantry": "Ticked to pantry",
      "sh.allIn": "{n} added to the pantry", "sh.noneTicked": "Tick what you bought first",
      "nu.title": "Per serving", "nu.est": "≈ {k} kcal · protein {p} g · carbs {c} g · fat {f} g",
      "nu.kcal": "≈ {k} kcal", "nu.counted": "An estimate from {n} of {m} ingredients.", "nu.none": "No estimate yet: no ingredient has a match.",
      "nu.check": "Check the ingredients", "nu.dlg": "Nutrition estimate", "nu.dlgHint": "Each ingredient's amount in grams × its values per 100 g. Pick a better match where needed; your choice is remembered for that ingredient in every recipe.",
      "nu.st.ok": "≈ {g} g · {src}", "nu.st.noqty": "no amount, not counted", "nu.st.nomatch": "no match", "nu.st.nogram": "weight unknown: set grams per piece",
      "nu.st.x": "left out", "nu.src.tbl": "built-in table", "nu.src.off": "Open Food Facts",
      "nu.change": "Change", "nu.match": "Match for “{name}”", "nu.search": "Search Open Food Facts", "nu.searching": "Searching…",
      "nu.noRes": "Nothing found. Try other words (English often finds more).", "nu.useTbl": "Built-in table:", "nu.leaveOut": "Leave it out",
      "nu.auto": "Automatic", "nu.pieceG": "Grams in one piece", "nu.saved": "Remembered for “{name}”",
      "nu.day": "≈ {k} kcal per person", "nu.dayPart": "≈ {k} kcal per person (some meals have no estimate)",
      "nu.credit": "Nutrition: our table from USDA FoodData Central (public domain) and Open Food Facts (ODbL, openfoodfacts.org). An estimate only, not dietary advice.",
      "s.nu": "Show nutrition estimates", "s.nt": "Best-before reminder", "s.ntHint": "An orOS notification the day before something in the pantry reaches its best-before date, and on the day. On this device.",
      "s.ntOff": "Off", "s.ntAt": "at {h}:00", "s.credits": "Data sources"
    },
    el: {
      "app.name": "Συνταγές & Μενού", "tab.rc": "Συνταγές", "tab.wk": "Εβδομάδα", "tab.sh": "Ψώνια", "btn.settings": "Ρυθμίσεις",
      "rc.search": "Αναζήτηση συνταγών, ή υλικά με κόμμα…", "rc.new": "Νέα συνταγή", "rc.paste": "Εισαγωγή",
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
      "sheet.open": "Άνοιγμα στο Υπολογιστικό φύλλο", "sheet.cap": "Χωρούν μόνο οι πρώτες {n} γραμμές σε ένα φύλλο",
      "sheet.weekNone": "Δεν υπάρχει τίποτα προγραμματισμένο αυτή την εβδομάδα", "sheet.shopNone": "Τίποτα για ψώνια αυτή την εβδομάδα",
      "bud.btn": "Στον Προϋπολογισμό", "bud.title": "Πόσα πλήρωσες;", "bud.amt": "Ποσό",
      "bud.bad": "Γράψε ένα ποσό πάνω από μηδέν, π.χ. 12,50", "bud.note": "Ψώνια: {n} είδη",
      "bud.go": "Συνέχεια στον Προϋπολογισμό", "bud.fail": "Ο Προϋπολογισμός δεν μπόρεσε να το ανοίξει", "bud.none": "Η λίστα είναι άδεια",
      "sheet.date": "Ημερομηνία", "sheet.day": "Ημέρα", "sheet.meal": "Γεύμα", "sheet.dish": "Φαγητό", "sheet.serv": "Μερίδες",
      "sheet.item": "Είδος", "sheet.qty": "Ποσότητα", "sheet.for": "Για", "sheet.done": "Τα πήρα",
      "aisle.produce": "Φρούτα & λαχανικά", "aisle.meat": "Κρέας", "aisle.fish": "Ψάρια & θαλασσινά", "aisle.dairy": "Γαλακτοκομικά & αυγά",
      "aisle.bakery": "Φούρνος", "aisle.pantry": "Ντουλάπι", "aisle.spices": "Μπαχαρικά & μυρωδικά", "aisle.frozen": "Κατεψυγμένα",
      "aisle.drinks": "Ποτά", "aisle.household": "Είδη σπιτιού", "aisle.other": "Άλλα",
      "course.": "Χωρίς είδος", "course.breakfast": "Πρωινό", "course.main": "Κυρίως", "course.side": "Συνοδευτικό",
      "course.salad": "Σαλάτα", "course.soup": "Σούπα", "course.dessert": "Γλυκό", "course.snack": "Σνακ", "course.drink": "Ρόφημα",
      "diet.vegan": "Vegan", "diet.veg": "Χορτοφαγική", "diet.pesc": "Pescatarian (με ψάρι)", "diet.raw": "Ωμοφαγική",
      "diet.keto": "Keto", "diet.lowcarb": "Λίγοι υδατάνθρακες", "diet.gf": "Χωρίς γλουτένη", "diet.lf": "Χωρίς λακτόζη",
      "diet.nut": "Χωρίς ξηρούς καρπούς", "diet.fast": "Νηστίσιμο",
      "dshort.vegan": "Vegan", "dshort.veg": "Χορτοφ.", "dshort.pesc": "Pesc", "dshort.raw": "Ωμοφ.", "dshort.keto": "Keto",
      "dshort.lowcarb": "Λίγοι υδατ.", "dshort.gf": "Χ. γλουτένη", "dshort.lf": "Χ. λακτόζη", "dshort.nut": "Χ. ξηρούς", "dshort.fast": "Νηστίσιμο",
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
      "p.title": "Εισαγωγή συνταγής", "p.hint": "Ή επικόλλησε μια συνταγή από οπουδήποτε: κείμενο από site, μήνυμα ή σημείωση, ή τον κώδικα μιας σελίδας (HTML) ή JSON. Τα υλικά και τα βήματα βρίσκονται μόνα τους και τα ελέγχεις πριν την αποθήκευση.",
      "p.go": "Συνέχεια", "p.empty": "Γράψε μια διεύθυνση ή επικόλλησε πρώτα κείμενο", "p.paste": "Επικόλληση συνταγής",
      "im.url": "Διεύθυνση (link) μιας συνταγής", "im.fetch": "Φέρε τη",
      "im.urlHint": "Δουλεύει με τα περισσότερα sites συνταγών. Όσα δεν αφήνουν τις εφαρμογές να τα διαβάσουν περνούν από το relay του orOS που έχεις ορίσει στην Αλληλογραφία ή στον Αναγνώστη.",
      "im.file": "Άνοιγμα αρχείου…", "im.fileHint": "Εξαγωγές από Paprika, Mela, Recipe Keeper, Crouton, MyCookbook, Mealie, Tandoor ή Nextcloud Cookbook, αρχεία Cooklang (.cook), μια αποθηκευμένη σελίδα (.html) ή JSON.",
      "im.loading": "Φέρνω τη σελίδα…", "im.reading": "Διαβάζω το αρχείο…",
      "im.none": "Δεν βρέθηκε συνταγή εκεί. Αντέγραψε το κείμενο της συνταγής και επικόλλησέ το παρακάτω.",
      "im.noneFile": "Δεν βρέθηκαν συνταγές σε αυτό το αρχείο.", "im.badUrl": "Γράψε μια διεύθυνση (https://…)",
      "im.err.offline": "Δεν υπάρχει σύνδεση.",
      "im.err.norelay": "Αυτό το site δεν αφήνει τις εφαρμογές να το διαβάσουν. Όρισε το relay του orOS στην Αλληλογραφία, ή άνοιξε τη σελίδα, αντέγραψε τη συνταγή και επικόλλησέ τη παρακάτω.",
      "im.err.status": "Το site απάντησε με σφάλμα ({n}).",
      "im.err.other": "Η σελίδα δεν διαβάστηκε ({code}). Αντέγραψε τη συνταγή και επικόλλησέ τη παρακάτω.",
      "im.err.file": "Το αρχείο δεν διαβάστηκε.",
      "im.many": "Βρέθηκαν {n} συνταγές", "im.manyHint": "Τσέκαρε όσες θέλεις να μπουν. Όσες έχεις ήδη (ίδιος τίτλος) ξεκινούν ατσεκάριστες.",
      "im.have": "την έχεις ήδη", "im.add": "Προσθήκη {n}", "im.all": "Όλες", "im.noneSel": "Καμία",
      "im.from": "Από {src}", "im.sum": "{n} συνταγές", "im.sumHave": "{n} συνταγές, οι {k} έχουν ήδη εισαχθεί",
      "im.stored": "έχει ήδη εισαχθεί", "im.counts": "{i} υλικά, {s} βήματα",
      "im.photos": "Οι φωτογραφίες δεν μεταφέρονται· κρατιέται μόνο ο σύνδεσμος μιας φωτογραφίας στο διαδίκτυο.",
      "v.photo": "Φωτογραφία (ανοίγει το site)",
      "un.label": "Μονάδες", "un.": "Όπως γράφτηκαν", "un.metric": "Μετρικές", "un.us": "ΗΠΑ",
      "s.units": "Μονάδες σε αυτή τη συσκευή", "s.unitsHint": "Οι συνταγές, το μαγείρεμα και η λίστα για ψώνια δείχνουν ποσότητες και θερμοκρασίες φούρνου σε αυτές τις μονάδες.",
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
      "s.file": "Αποθήκευση και άνοιγμα", "file.save": "Αρχείο orOS (.orosmeals)", "file.open": "Άνοιγμα αρχείου orOS…",
      "file.copy": "Άνοιγμα ως αντίγραφο…", "file.folder": "Αποσυμπιεσμένος φάκελος orOS…",
      "file.copyHint": "Το «Άνοιγμα ως αντίγραφο» προσθέτει τις συνταγές του αρχείου ως νέες, ακόμη κι αυτές που έχεις ήδη.",
      "s.close": "Κλείσιμο", "s.slotName": "Όνομα για: {slot}",
      "toast.saved": "Η συνταγή αποθηκεύτηκε", "toast.deleted": "Διαγράφηκε: «{t}»", "toast.copied": "Αντιγράφηκε",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.imported": "Εισήχθησαν: {n} συνταγές", "toast.importBad": "Αυτό το αρχείο δεν είναι αντίγραφο του Meal Planner",
      "toast.exported": "Το αντίγραφο αποθηκεύτηκε", "toast.nothing": "Τίποτα για μοίρασμα", "toast.removedItem": "Αφαιρέθηκε",
      "copy.suffix": "{t} (αντίγραφο)", "share.serv": "{n} μερίδες",
      "tab.pa": "Κελάρι", "loc.fridge": "Ψυγείο", "loc.freezer": "Καταψύκτης", "loc.cupboard": "Ντουλάπι", "loc.all": "Όλα",
      "pa.add": "Πρόσθεσε: «1 λίτρο γάλα», «6 αυγά»…", "pa.addBtn": "Προσθήκη στο κελάρι", "pa.scan": "Barcode", "pa.cook": "Τι να μαγειρέψω;",
      "pa.empty": "Το κελάρι είναι άδειο. Πρόσθεσε ό,τι έχεις στο σπίτι, σάρωσε ένα barcode ή τσέκαρε είδη στα Ψώνια.",
      "pa.emptyLoc": "Τίποτα εδώ.", "pa.soon": "Να φαγωθούν σύντομα", "pa.bbIn": "λήγει {d}", "pa.today": "λήγει σήμερα",
      "pa.tomorrow": "λήγει αύριο", "pa.days": "μένουν {n} μέρες", "pa.expired": "έληξε ({d})",
      "pa.some": "υπάρχει", "pa.edit": "Επεξεργασία: {name}", "pa.added": "Μπήκε στο κελάρι: {name}", "pa.more": "Προστέθηκε {name}: τώρα {q}",
      "pa.removed": "Βγήκε από το κελάρι", "pa.max": "Έως {n} είδη στο κελάρι",
      "pe.new": "Προσθήκη στο κελάρι", "pe.edit": "Είδος στο κελάρι", "pe.name": "Όνομα", "pe.qty": "Ποσότητα", "pe.unit": "Μονάδα",
      "pe.loc": "Φυλάσσεται", "pe.bb": "Ανάλωση έως", "pe.bc": "Barcode", "pe.save": "Αποθήκευση", "pe.del": "Αφαίρεση",
      "pe.needName": "Δώσε ένα όνομα",
      "u.pc": "τεμάχια", "u.": "—",
      "bc.title": "Προσθήκη με barcode", "bc.code": "Αριθμός barcode", "bc.look": "Αναζήτηση", "bc.cam": "Στόχευσε το barcode με την κάμερα",
      "bc.camOff": "Η κάμερα δεν μπορεί να χρησιμοποιηθεί εδώ. Γράψε τον αριθμό κάτω από το barcode.", "bc.bad": "Αυτός ο αριθμός δεν μοιάζει με barcode (8, 12, 13 ή 14 ψηφία).",
      "bc.looking": "Αναζήτηση στο Open Food Facts…", "bc.notFound": "Δεν υπάρχει στο Open Food Facts. Μπορείς να το προσθέσεις με το όνομά του.",
      "bc.known": "Το έχεις ήδη: {name}", "bc.add": "Προσθήκη στο κελάρι", "bc.addName": "Προσθήκη με όνομα",
      "bc.per100": "ανά 100 γρ.: {k} kcal · πρωτεΐνη {p} γρ. · υδατάνθρακες {c} γρ. · λιπαρά {f} γρ.", "bc.page": "Δες το στο Open Food Facts",
      "net.offline": "Δεν υπάρχει σύνδεση.", "net.err": "Το Open Food Facts δεν απάντησε ({code}). Δοκίμασε ξανά αργότερα.",
      "ck.title": "Τι να μαγειρέψω;", "ck.hint": "Οι συνταγές με βάση το πόσα από τα υλικά τους υπάρχουν ήδη στο σπίτι. Όσα έχεις πάντα μετράνε ως διαθέσιμα.",
      "ck.none": "Καμία συνταγή δεν χρησιμοποιεί ακόμα κάτι από το κελάρι.", "ck.have": "{h} από {n} στο σπίτι", "ck.all": "Υπάρχουν όλα στο σπίτι",
      "ck.missing": "Λείπουν: {list}", "ck.low": "Δεν φτάνουν: {list}", "ck.soonUse": "χρησιμοποιεί κάτι που πρέπει να φαγωθεί σύντομα",
      "ck.addMissing": "Όσα λείπουν στη λίστα", "ck.addedMissing": "Μπήκαν {n} στη λίστα για ψώνια της εβδομάδας", "ck.open": "Άνοιγμα",
      "co.btn": "Το μαγείρεψα", "co.title": "Μαγειρεύτηκε: αφαίρεση από το κελάρι", "co.hint": "Ξετσέκαρε όσα δεν χρησιμοποίησες. Τίποτα δεν αλλάζει πριν πατήσεις «Αφαίρεση από το κελάρι».",
      "co.line": "{take} από {have} → μένουν {left}", "co.gone": "{take}: τελείωσε", "co.usedUp": "Τελείωσε (βγαίνει: {name})",
      "co.short": "{n} παραπάνω από όσα είχε το κελάρι", "co.notIn": "Δεν υπάρχει στο κελάρι", "co.ok": "Αφαίρεση από το κελάρι",
      "co.done": "Το κελάρι ενημερώθηκε", "co.nothing": "Κανένα υλικό αυτής της συνταγής δεν είναι στο κελάρι.",
      "sh.home": "Υπάρχουν ήδη στο σπίτι (κελάρι):", "sh.homeHint": "Υπάρχουν στο κελάρι σε αρκετή ποσότητα: δεν μετράνε, δεν αντιγράφονται, δεν στέλνονται.",
      "sh.have": "στο σπίτι: {q}", "sh.toPantry": "Στο κελάρι", "sh.bought": "Τσεκαρίστηκε: {name}", "sh.tickedToPantry": "Τσεκαρισμένα στο κελάρι",
      "sh.allIn": "Μπήκαν {n} στο κελάρι", "sh.noneTicked": "Τσέκαρε πρώτα όσα αγόρασες",
      "nu.title": "Ανά μερίδα", "nu.est": "≈ {k} kcal · πρωτεΐνη {p} γρ. · υδατάνθρακες {c} γρ. · λιπαρά {f} γρ.",
      "nu.kcal": "≈ {k} kcal", "nu.counted": "Εκτίμηση από {n} από τα {m} υλικά.", "nu.none": "Καμία εκτίμηση ακόμα: κανένα υλικό δεν έχει αντιστοίχιση.",
      "nu.check": "Έλεγχος υλικών", "nu.dlg": "Εκτίμηση θρεπτικών", "nu.dlgHint": "Η ποσότητα κάθε υλικού σε γραμμάρια × οι τιμές του ανά 100 γρ. Διάλεξε καλύτερη αντιστοίχιση όπου χρειάζεται· η επιλογή σου μένει για αυτό το υλικό σε όλες τις συνταγές.",
      "nu.st.ok": "≈ {g} γρ. · {src}", "nu.st.noqty": "χωρίς ποσότητα, δεν μετράει", "nu.st.nomatch": "χωρίς αντιστοίχιση", "nu.st.nogram": "άγνωστο βάρος: όρισε γραμμάρια ανά τεμάχιο",
      "nu.st.x": "εκτός εκτίμησης", "nu.src.tbl": "ενσωματωμένος πίνακας", "nu.src.off": "Open Food Facts",
      "nu.change": "Αλλαγή", "nu.match": "Αντιστοίχιση για «{name}»", "nu.search": "Αναζήτηση στο Open Food Facts", "nu.searching": "Αναζήτηση…",
      "nu.noRes": "Δεν βρέθηκε τίποτα. Δοκίμασε άλλες λέξεις (στα αγγλικά βρίσκονται συχνά περισσότερα).", "nu.useTbl": "Ενσωματωμένος πίνακας:", "nu.leaveOut": "Να μη μετράει",
      "nu.auto": "Αυτόματα", "nu.pieceG": "Γραμμάρια ανά τεμάχιο", "nu.saved": "Θα το θυμάμαι για «{name}»",
      "nu.day": "≈ {k} kcal ανά άτομο", "nu.dayPart": "≈ {k} kcal ανά άτομο (κάποια γεύματα χωρίς εκτίμηση)",
      "nu.credit": "Θρεπτικά: ο πίνακάς μας από το USDA FoodData Central (κοινό κτήμα) και το Open Food Facts (ODbL, openfoodfacts.org). Μόνο εκτίμηση, όχι διατροφική συμβουλή.",
      "s.nu": "Εμφάνιση εκτίμησης θρεπτικών", "s.nt": "Υπενθύμιση λήξης", "s.ntHint": "Μια ειδοποίηση του orOS την προηγούμενη μέρα πριν λήξει κάτι από το κελάρι, και την ίδια μέρα. Σε αυτή τη συσκευή.",
      "s.ntOff": "Όχι", "s.ntAt": "στις {h}:00", "s.credits": "Πηγές δεδομένων"
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
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
    barcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6v12M8 6v12M11 6v12M15 6v12M18 6v12M21 6v12"/></svg>',
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
      tab: TABS.indexOf(p.tab) >= 0 ? p.tab : "wk",
      fits: p.fits === 0 ? 0 : 1,
      from: p.from === 1 ? 1 : 0,
      un: p.un === "metric" || p.un === "us" ? p.un : "",     // units shown (wave 2): "" as written
      nu: p.nu === 0 ? 0 : 1,                                 // nutrition estimates shown (wave 3)
      nt: P.notifyHour(p),                                    // best-before reminder hour, -1 off (wave 3; read by the shell)
      loc: C.LOCS.indexOf(p.loc) >= 0 ? p.loc : ""            // pantry filter (wave 3)
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
  // The week's list against the pantry (wave 3): lines the pantry
  // covers go to `home` (not counted, copied or sent); a line partly
  // there says how much is at home.
  function shopList() {
    var l = C.buildShop(data, getRecipe, view.wk, prefs.from ? today() : null, LANG, prefs.un);
    l.home = [];
    if (data.pa.length) {
      l.items = l.items.filter(function (it) {
        if (it.manual) return true;
        var c = P.coverShop(data.pa, it);
        if (c.st === "none") return true;
        it.have = P.haveText(c.items, LANG);
        if (c.st === "full") { l.home.push(it); return false; }
        return true;
      });
    }
    return l;
  }
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
    TABS.forEach(function (x) {
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
    var nuCache = {};
    C.weekDays(view.wk).forEach(function (d) {
      var day = el("section", "day" + (d === td ? " today" : ""));
      day.setAttribute("aria-label", fmtDay(d, true));
      var dh = el("h3", "day-h", fmtDay(d));
      var kc = dayKcal(d, nuCache);
      if (kc) {
        var ks = el("span", "day-kcal", kc.txt);
        ks.title = kc.title;
        ks.setAttribute("aria-label", kc.title);
        dh.appendChild(ks);
      }
      day.appendChild(dh);
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
    function shopRow(it) {
      var li = el("li", "sh-item" + (it.done ? " done" : ""));
      var lab = el("label", "sh-lab");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = it.done;
      cb.addEventListener("change", function () {
        setTick(it, cb.checked);
        it.done = cb.checked;
        li.classList.toggle("done", cb.checked);
        renderShopCount(shopList());
        // Bought: offer to put it in the pantry (wave 3).
        if (cb.checked && !it.pa) actionToast(t("sh.bought", { name: it.name }), t("sh.toPantry"), function () { shopToPantry([it]); });
      });
      lab.appendChild(cb);
      var txt = el("span", "sh-txt");
      if (it.qty) txt.appendChild(el("b", "sh-qty", it.qty));
      txt.appendChild(el("span", "sh-name", it.name));
      if (it.have) txt.appendChild(el("span", "sh-have", "🏠 " + t("sh.have", { q: it.have })));
      if (it.from.length) txt.appendChild(el("span", "sh-from", t("sh.from.recipes", { list: it.from.join(", ") })));
      lab.appendChild(txt);
      li.appendChild(lab);
      var more = el("button", "mini");
      more.type = "button";
      more.innerHTML = UI.more;
      more.setAttribute("aria-label", t("sh.more", { name: it.name }));
      more.addEventListener("click", function () { openShopItem(it); });
      li.appendChild(more);
      return li;
    }
    list.items.forEach(function (it) {
      if (it.aisle !== aisle) {
        aisle = it.aisle;
        box.appendChild(el("h3", "aisle-h", aisleName(aisle)));
        ul = el("ul", "shop");
        box.appendChild(ul);
      }
      ul.appendChild(shopRow(it));
    });
    var hb = $("sh-home");
    hb.innerHTML = "";
    hb.hidden = !list.home.length;
    if (list.home.length) {
      hb.appendChild(el("h3", "aisle-h", "🏠 " + t("sh.home")));
      hb.appendChild(el("p", "hint", t("sh.homeHint")));
      var hu = el("ul", "shop");
      list.home.forEach(function (it) { hu.appendChild(shopRow(it)); });
      hb.appendChild(hu);
    }
    $("sh-empty").hidden = list.items.length + list.home.length > 0;
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

  // "Open in Spreadsheet" (Bible BR-S1): the week on screen (one row
  // per planned dish) or its shopping list as a new sheet in the orOS
  // Spreadsheet. Shell only (shellOpenAt); dates YYYY-MM-DD.
  var SHEET_ROWS = 499;   // + heading = the Spreadsheet's 500
  function openInSheet(name, head, rows) {
    var p = shellOpenAt();
    if (!p) return;
    if (rows.length > SHEET_ROWS) { showToast(t("sheet.cap", { n: SHEET_ROWS })); rows = rows.slice(0, SHEET_ROWS); }
    p.__orosOpenAt("spreadsheet", { newSheet: { name: name.slice(0, 31), rows: [head].concat(rows) } });
  }
  function weekToSheet() {
    var wd = new Intl.DateTimeFormat(LOCALE, { weekday: "long" }), rows = [];
    C.weekDays(view.wk).forEach(function (d) {
      var day = wd.format(new Date(d + "T12:00:00"));
      data.set.sl.forEach(function (s) {
        cellItems(cellKey(d, s)).forEach(function (it) {
          var L = itemLabel(it);
          rows.push([d, day, slotName(s), L.t, L.sv || ""]);
        });
      });
    });
    if (!rows.length) { showToast(t("sheet.weekNone")); return; }
    openInSheet(t("app.name") + " " + view.wk,
      [t("sheet.date"), t("sheet.day"), t("sheet.meal"), t("sheet.dish"), t("sheet.serv")], rows);
  }
  function shopToSheet() {
    var rows = shopList().items.map(function (it) {
      return [aisleName(it.aisle), it.name, it.qty, it.from.join(", "), it.done ? "✓" : ""];
    });
    if (!rows.length) { showToast(t("sheet.shopNone")); return; }
    openInSheet(t("tab.sh") + " " + view.wk,
      [t("sh.aisle"), t("sheet.item"), t("sheet.qty"), t("sheet.for"), t("sheet.done")], rows);
  }

  // "Add to Budget" (Bible BR-B1): the list has no prices, so a small
  // dialog asks what was paid; Budget opens its New expense form
  // prefilled (Groceries, today) and stores nothing until Save there.
  // The note counts the ticked items (bought), or all when none is.
  function budgetBridge() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenBudgetNew === "function" ? p.__orosOpenBudgetNew : null;
    } catch (e) { return null; }
  }
  function shopToBudget() {
    if (!budgetBridge()) return;
    var all = shopList().items, got = all.filter(function (it) { return it.done; });
    var items = got.length ? got : all;
    if (!items.length) { showToast(t("bud.none")); return; }
    var dlg = makeDialog("ml-bud");
    dlg.appendChild(el("div", "dlg-title", t("bud.title")));
    var form = el("form", "edit-form");
    form.method = "dialog";
    var fA = el("input");
    fA.inputMode = "decimal"; fA.maxLength = 20; fA.autocomplete = "off"; fA.placeholder = "0,00";
    form.appendChild(labeled(t("bud.amt"), fA));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("e.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("bud.go"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var a = C.parseAmount(fA.value);
      if (a === null) { showToast(t("bud.bad")); fA.focus(); return; }
      var n = t("bud.note", { n: items.length }) + " · " + items.map(function (it) { return it.name; }).join(", ");
      if (n.length > 500) n = n.slice(0, 499) + "…";
      var open = budgetBridge(), res = false;
      dlg.close();
      try { res = open ? open({ k: "o", a: a, c: "o-groc", d: today(), n: n, src: "meals" }) : false; } catch (e2) {}
      if (res === false) showToast(t("bud.fail"));
    });
    dlg.appendChild(form);
    showDialog(dlg);
    fA.focus();
  }

  function renderAll() {
    renderRecipes();
    renderWeek();
    renderShop();
    renderPantry();
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
    svRow.appendChild(unitsSeg(function () { drawIngs(); drawSteps(); }));
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
        var q = C.fmtIngQty(ing, LANG, sv / r.sv, prefs.un);
        var sp = el("span", "");
        if (q) sp.appendChild(el("b", "", q + " "));
        sp.appendChild(document.createTextNode(ing.n + (ing.x ? ", " + ing.x : "")));
        lab.appendChild(sp);
        li.appendChild(lab);
        ul.appendChild(li);
      });
    }
    drawIngs();
    if (prefs.nu) left.appendChild(nutritionBox(r));
    cols.appendChild(left);
    var right = el("div", "v-col");
    right.appendChild(el("h3", "sec-h", t("v.steps")));
    var stepBox = el("div", "");
    right.appendChild(stepBox);
    function drawSteps() {
      stepBox.innerHTML = "";
      if (!r.st.length) { stepBox.appendChild(el("p", "hint", t("v.nosteps"))); return; }
      var ol = el("ol", "steps");
      r.st.forEach(function (s) { ol.appendChild(el("li", "", C.convertTemps(s, prefs.un))); });
      stepBox.appendChild(ol);
    }
    drawSteps();
    if (r.no) {
      right.appendChild(el("h3", "sec-h", t("v.notes")));
      right.appendChild(el("p", "notes", r.no));
    }
    if (r.src || r.img) {
      right.appendChild(el("h3", "sec-h", t("v.source")));
      if (r.src) right.appendChild(sourceNode(r.src));
      if (r.img) {
        // The picture stays on its site: a link, never loaded here.
        var ph = sourceNode(r.img);
        if (ph.tagName === "A") { ph.textContent = "🖼 " + t("v.photo"); ph.className = "src-link photo-link"; }
        right.appendChild(ph);
      }
    }
    cols.appendChild(right);
    dlg.appendChild(cols);

    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("v.cookmode"), "primary", function () { dlg.close(); openCook(id, sv); }));
    acts.appendChild(button(t("co.btn"), "", function () { dlg.close(); openCooked(id, sv); }));
    acts.appendChild(button(t("v.toplan"), "", function () { dlg.close(); openAddToPlan(id, sv); }));
    acts.appendChild(button(t("v.edit"), "", function () { dlg.close(); openEditor(r); }));
    acts.appendChild(button(t("v.share"), "", function () {
      var api = shareApi();
      if (!api) { shareText(r.t, recipeText(r, sv)); return; }
      dlg.close();
      api.open({ kind: "recipe", data: sharePayload(r), text: recipeText(r, sv) });
    }));
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
    var un = prefs.un;
    var out = [(r.e ? r.e + " " : "") + r.t, t("share.serv", { n: sv }), ""];
    out.push(t("v.ings") + ":");
    var g = "";
    r.ig.forEach(function (ing) {
      if (ing.g && ing.g !== g) { g = ing.g; out.push(g + ":"); }
      out.push("- " + C.ingToLine(ing, LANG, sv / r.sv, un));
    });
    if (r.st.length) {
      out.push("", t("v.steps") + ":");
      r.st.forEach(function (s, i) { out.push((i + 1) + ". " + C.convertTemps(s, un)); });
    }
    if (r.no) out.push("", r.no);
    if (r.src) out.push("", t("v.source") + ": " + r.src);
    return out.join("\n");
  }
  // "Send to someone" (shell share/, kind "recipe"): the recipe as
  // stored, without its id, stamp or favourite mark.
  function shareApi() {
    try { return window.parent !== window && window.parent.orosShare ? window.parent.orosShare : null; }
    catch (e) { return null; }
  }
  function sharePayload(r) {
    var o = { t: r.t, e: r.e, c: r.c, sv: r.sv, pt: r.pt, ct: r.ct, dt: r.dt, tg: r.tg,
      ig: r.ig, st: r.st, no: r.no, src: r.src };
    if (r.img) o.img = r.img;
    return o;
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
    r.ig.forEach(function (ing) { ul.appendChild(el("li", "", C.ingToLine(ing, LANG, sv / r.sv, prefs.un))); });
    box.appendChild(ul);
    box.appendChild(el("h2", "", t("v.steps")));
    var ol = el("ol");
    r.st.forEach(function (s) { ol.appendChild(el("li", "", C.convertTemps(s, prefs.un))); });
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
        img: src.img || "",
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
      var id = isNew ? (src.impId && !storedRecipe(src.impId) ? src.impId : newId("r")) : src.id;
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

  // Import: a web address, pasted text (plain, a page's source or
  // JSON) or a file (Paprika, Mealie, Tandoor, HTML, JSON). Pages and
  // files are read as data by import.js; one recipe opens in the
  // editor, several in a list to tick. Nothing is saved without Save /
  // Add. The Reader's network layer (../feeds/fetch.js: direct, else
  // the orOS relay's "web" op) and the ZIP reader (../atelier/zip.js)
  // load only when needed.
  var APP_V = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? m[1] : "";
  })();
  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src + (APP_V ? "?v=" + encodeURIComponent(APP_V) : "");
      s.onload = function () { resolve(); };
      s.onerror = function () { delete loaded[src]; reject(new Error("load")); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  function needImport() { return window.OrosMealsImport ? Promise.resolve(window.OrosMealsImport) : loadScript("import.js").then(function () { return window.OrosMealsImport; }); }
  function needFetch() {
    return loadScript("../feeds/core.js").then(function () { return loadScript("../feeds/fetch.js"); })
      .then(function () { return window.orosFeedsFetch; });
  }
  function needZip() { return window.AtelierZip ? Promise.resolve(window.AtelierZip) : loadScript("../atelier/zip.js").then(function () { return window.AtelierZip; }); }
  // The relay the Reader uses (its own setting, else Mail's), read only.
  function readerRelay() {
    try {
      var fc = window.orosFeedsCore, raw = JSON.parse(localStorage.getItem("oros-feeds-data") || "null");
      if (fc && raw && raw.set && typeof fc.setting === "function") return fc.setting(raw, "relay") || "";
    } catch (e) {}
    return "";
  }
  function normUrl(s) {
    s = String(s || "").trim();
    if (!s || /\s/.test(s)) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    try {
      var u = new URL(s);
      if ((u.protocol !== "https:" && u.protocol !== "http:") || !/\./.test(u.hostname)) return "";
      return u.href;
    } catch (e) { return ""; }
  }

  function openPaste() {
    var dlg = makeDialog("ml-paste", "wide");
    dlg.appendChild(el("div", "dlg-title", t("p.title")));
    var busy = false;
    // Web address
    var urow = el("div", "add-row");
    var uin = el("input");
    uin.type = "url";
    uin.inputMode = "url";
    uin.maxLength = 2000;
    uin.autocomplete = "off";
    uin.placeholder = "https://…";
    var ulab = el("label", "dlg-lbl", t("im.url"));
    uin.id = "ml-im-url";
    ulab.setAttribute("for", uin.id);
    var fetchBtn = button(t("im.fetch"), "primary", function () { goUrl(uin.value); });
    uin.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); goUrl(uin.value); } });
    urow.appendChild(uin); urow.appendChild(fetchBtn);
    dlg.appendChild(ulab);
    dlg.appendChild(urow);
    dlg.appendChild(el("p", "hint", t("im.urlHint")));
    var status = el("p", "im-status");
    status.setAttribute("role", "status");
    status.hidden = true;
    dlg.appendChild(status);
    // Paste
    var plab = el("label", "dlg-lbl", t("p.paste"));
    var ta = el("textarea", "paste-in");
    ta.id = "ml-im-text";
    plab.setAttribute("for", ta.id);
    ta.rows = 9;
    ta.maxLength = 3000000;
    dlg.appendChild(plab);
    dlg.appendChild(el("p", "hint", t("p.hint")));
    dlg.appendChild(ta);
    // File
    var frow = el("div", "im-file");
    frow.appendChild(button(t("im.file"), "small", pickFile));
    frow.appendChild(el("span", "hint", t("im.fileHint")));
    dlg.appendChild(frow);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("e.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("p.go"), "primary", goText));
    dlg.appendChild(acts);
    showDialog(dlg);
    if (!coarse()) uin.focus();

    function say(msg, bad) {
      status.hidden = !msg;
      status.textContent = msg || "";
      status.classList.toggle("bad", !!bad);
    }
    function lock(on) {
      busy = on;
      fetchBtn.disabled = on;
      uin.disabled = on;
    }
    // One recipe opens in the editor (with its stable id, so saving it
    // twice from the same file is not possible); several, or one already
    // imported, open the list.
    function done(list, emptyMsg, I) {
      lock(false);
      if (!dlg.open) return;
      if (!list.length) { say(emptyMsg, true); return; }
      dlg.close();
      var one = list.length === 1 && I && list[0].t ? I.prepareBatch(list, [])[0] : null;
      if (list.length === 1 && !(one && storedRecipe(one.id))) openEditor(one ? Object.assign({ impId: one.id }, list[0]) : list[0]);
      else openImportList(list, I);
    }
    function goUrl(raw) {
      if (busy) return;
      var url = normUrl(raw);
      if (!url) { say(t("im.badUrl"), true); uin.focus(); return; }
      uin.value = url;
      lock(true);
      say(t("im.loading"));
      Promise.all([needImport(), needFetch()]).then(function (mods) {
        var I = mods[0], F = mods[1];
        return F.fetchOne(url, { relay: readerRelay, timeout: 20000,
                                 accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,application/json;q=0.8,*/*;q=0.5" })
          .then(function (r) {
            if (r.status < 200 || r.status >= 300) { lock(false); say(t("im.err.status", { n: r.status }), true); return; }
            var list = I.fromText(r.text || "", r.finalUrl || url);
            list.forEach(function (d) { if (!d.src) d.src = r.finalUrl || url; });
            done(list, t("im.none"), I);
          });
      }).catch(function (e) {
        lock(false);
        var code = (e && e.code) || "load";
        if (code === "offline") say(t("im.err.offline"), true);
        else if (code === "norelay" || code === "cors") say(t("im.err.norelay"), true);
        else say(t("im.err.other", { code: code }), true);
      });
    }
    function goText() {
      if (busy) return;
      var v = ta.value;
      if (!v.trim()) {
        if (uin.value.trim()) { goUrl(uin.value); return; }
        say(t("p.empty"), true); ta.focus(); return;
      }
      if (/^\s*https?:\/\/\S+\s*$/i.test(v)) { goUrl(v); return; }
      needImport().then(function (I) {
        if (I.looksLikeData(v)) { done(I.fromText(v, ""), t("im.none"), I); return; }
        var d = C.parseRecipeText(v);
        dlg.close();
        openEditor({ t: d.t, sv: d.sv || 4, pt: d.pt || 0, ct: d.ct || 0, ig: d.ig, st: d.st, no: d.no, dt: [], tg: [] });
      }, function () { say(t("im.err.other", { code: "load" }), true); });
    }
    function pickFile() {
      if (busy) return;
      var accept = ".paprikarecipes,.paprikarecipe,.melarecipes,.melarecipe,.crumb,.cook,.mcb,.xml,.zip,.json,.html,.htm,application/json,application/zip,text/html";
      var host = dialogHost();
      var pick = host && typeof host.openFile === "function" ? host.openFile(accept) : localPickFile(accept);
      Promise.resolve(pick).then(function (file) {
        if (!file) return;
        lock(true);
        say(t("im.reading"));
        return Promise.all([needImport(), file.arrayBuffer()]).then(function (res) {
          var I = res[0], bytes = new Uint8Array(res[1]);
          var zip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
          return (zip ? needZip() : Promise.resolve(null)).then(function (Z) {
            return I.fromBytes(bytes, file.name || "", Z);
          }).then(function (list) { done(list, t("im.noneFile"), I); });
        });
      }).catch(function () { lock(false); say(t("im.err.file"), true); });
    }
  }

  // Several recipes (an export from Paprika, Mela, Recipe Keeper…, a
  // page with many): a preview of where they come from and what is
  // already here, then tick the ones to add. Each gets a stable id
  // ("imp-" + hash of source and title, import.js): one already
  // imported cannot be ticked, titles you already have start unticked.
  // Add = ONE write and ONE sync mark, with Undo.
  function openImportList(list, I) {
    var items = I.prepareBatch(list, data.rc.map(function (r) { return r.id; }));
    var dlg = makeDialog("ml-implist", "wide");
    dlg.appendChild(el("div", "dlg-title", t("im.many", { n: items.length })));
    var srcs = [];
    items.forEach(function (it) {
      var nmx = I.FORMATS[it.d.fmt] || "";
      if (nmx && srcs.indexOf(nmx) < 0) srcs.push(nmx);
    });
    var nStored = items.filter(function (it) { return it.stored; }).length;
    var sum = el("p", "im-sum");
    if (srcs.length) sum.textContent = t("im.from", { src: srcs.join(", ") }) + " · ";
    sum.textContent += t(nStored ? "im.sumHave" : "im.sum", { n: items.length, k: nStored });
    dlg.appendChild(sum);
    dlg.appendChild(el("p", "hint", t("im.manyHint") + " " + t("im.photos")));
    var have = {};
    recipes().forEach(function (r) { have[C.fold(r.t)] = 1; });
    var boxes = [];
    var sel = el("div", "chips");
    var ul = el("ul", "im-list");
    items.forEach(function (it) {
      var d = it.d;
      var li = el("li", "");
      var lab = el("label", "check");
      var cb = el("input");
      cb.type = "checkbox";
      var dup = !!have[C.fold(d.t)];
      cb.checked = !dup && !it.stored;
      cb.disabled = it.stored;
      cb.addEventListener("change", count);
      lab.appendChild(cb);
      var sp = el("span", "", d.t);
      var meta = t("im.counts", { i: d.ig.length, s: d.st.length });
      if (it.stored) meta += " · " + t("im.stored");
      else if (dup) meta += " · " + t("im.have");
      sp.appendChild(el("span", "hint", " · " + meta));
      lab.appendChild(sp);
      li.appendChild(lab);
      ul.appendChild(li);
      boxes.push(cb);
    });
    var all = el("button", "chip small", t("im.all"));
    all.type = "button";
    all.addEventListener("click", function () { boxes.forEach(function (b) { if (!b.disabled) b.checked = true; }); count(); });
    var none = el("button", "chip small", t("im.noneSel"));
    none.type = "button";
    none.addEventListener("click", function () { boxes.forEach(function (b) { b.checked = false; }); count(); });
    sel.appendChild(all); sel.appendChild(none);
    dlg.appendChild(sel);
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("e.cancel"), "", function () { dlg.close(); }));
    var ok = button("", "primary", function () {
      var pick = items.filter(function (it, i) { return boxes[i].checked && !it.stored; });
      dlg.close();
      importBatch(pick);
    });
    acts.appendChild(ok);
    dlg.appendChild(acts);
    function count() {
      var n = boxes.filter(function (b) { return b.checked && !b.disabled; }).length;
      ok.textContent = t("im.add", { n: n });
      ok.disabled = !n;
    }
    count();
    showDialog(dlg);
  }
  // [{ id, d }] → stored in one commit. A recipe already stored under
  // that id is never touched; one deleted before (a tomb) comes back
  // newer than its tomb (R17). Undo: newer tombs for exactly the added
  // ids, so another device that already pulled them drops them too.
  function importBatch(items) {
    var added = [], ts = now(), full = false;
    items.forEach(function (it) {
      if (storedRecipe(it.id)) return;
      if (data.rc.length >= C.LIM.recipes) { full = true; return; }
      var x = C.normRecipe(Object.assign({}, it.d, { id: it.id, fv: 0, m: 0 }));
      if (!x) return;
      x.m = Math.max(ts, (data.tombs[it.id] || 0) + 1);
      data.rc.push(x);
      added.push(it.id);
    });
    if (full) showToast(t("e.max", { n: C.LIM.recipes }));
    if (!added.length) return 0;
    commit();
    renderAll();
    undoToast(t("toast.imported", { n: added.length }), function () {
      var t2 = now();
      added.forEach(function (id) {
        var r = storedRecipe(id);
        if (r) data.tombs[id] = Math.max(data.tombs[id] || 0, t2, r.m);
      });
      data.rc = data.rc.filter(function (r) { return added.indexOf(r.id) < 0; });
      commit();
      renderAll();
    });
    return added.length;
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

  // "As written / Metric / US": a per-device choice (prefs.un).
  function unitsSeg(onChange) {
    var box = el("span", "seg");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", t("un.label"));
    var btns = [];
    ["", "metric", "us"].forEach(function (u) {
      var b = el("button", "chip small", t("un." + u));
      b.type = "button";
      b.addEventListener("click", function () {
        if (prefs.un === u) return;
        prefs.un = u;
        savePrefs();
        btns.forEach(function (x) { x.b.setAttribute("aria-pressed", x.u === u ? "true" : "false"); x.b.classList.toggle("on", x.u === u); });
        onChange(u);
        renderShop();
      });
      b.setAttribute("aria-pressed", prefs.un === u ? "true" : "false");
      b.classList.toggle("on", prefs.un === u);
      btns.push({ u: u, b: b });
      box.appendChild(b);
    });
    return box;
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
    sv = sv || r.sv;
    // Servings and units here too: the list follows, ticks stay.
    var svRow = el("div", "sv-row");
    svRow.appendChild(el("span", "dlg-lbl inline", t("v.servings")));
    svRow.appendChild(stepper(sv, 1, C.LIM.servings, t("v.less"), t("v.more"), function (v) { sv = v; drawIngs(); }));
    svRow.appendChild(unitsSeg(function () { drawIngs(); draw(); }));
    dlg.appendChild(svRow);
    var ingT = el("details", "ck-ings");
    var sum = el("summary", "");
    ingT.appendChild(sum);
    var ul = el("ul", "ings");
    var spans = [];
    r.ig.forEach(function (ing) {
      var li = el("li", "");
      var lab = el("label", "ing-lab");
      var cb = el("input"); cb.type = "checkbox";
      lab.appendChild(cb);
      var sp = el("span", "");
      spans.push(sp);
      lab.appendChild(sp);
      li.appendChild(lab);
      ul.appendChild(li);
    });
    function drawIngs() {
      sum.textContent = t("ck.ings") + " · " + t("share.serv", { n: sv });
      r.ig.forEach(function (ing, k) { spans[k].textContent = C.ingToLine(ing, LANG, sv / r.sv, prefs.un); });
    }
    drawIngs();
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
      text.textContent = C.convertTemps(steps[i], prefs.un);
      prev.disabled = i === 0;
      if (i >= steps.length - 1) { next.textContent = t("ck.done"); next.removeAttribute("aria-label"); }
      else { next.innerHTML = UI.right; next.setAttribute("aria-label", t("ck.next")); }
      tbox.innerHTML = "";
      if (i >= steps.length - 1 && data.pa.length) tbox.appendChild(button(t("co.btn"), "small", function () { dlg.close(); openCooked(id, sv); }));
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

  // ---------- 10b. Pantry (wave 3) ----------
  // What is at home: data.pa (synced, per-item LWW + tombs, see core.js).
  // Pure rules in pantry.js (OrosMealsPantry) and nutrition.js.
  function pantryItem(id) {
    for (var i = 0; i < data.pa.length; i++) if (data.pa[i].id === id) return data.pa[i];
    return null;
  }
  function newPantryId() { return "pa-" + newId("").slice(0, 30); }
  // Write one item (new: no id). R27: no change, no stamp. No commit.
  function putPantryRaw(x) {
    var cur = x.id ? pantryItem(x.id) : null;
    if (!cur && data.pa.length >= C.LIM.pantry) { showToast(t("pa.max", { n: C.LIM.pantry })); return null; }
    var id = cur ? cur.id : newPantryId();
    var nx = C.normPantryItem(Object.assign({}, x, { id: id, m: 1 }));
    if (!nx) return null;
    if (cur) { var a = clone(cur); a.m = 1; if (JSON.stringify(a) === JSON.stringify(nx)) return cur; }
    nx.m = bump(cur ? cur.m : 0);
    if (id in data.tombs) nx.m = Math.max(nx.m, data.tombs[id] + 1);
    data.pa = data.pa.filter(function (i) { return i.id !== id; });
    data.pa.push(nx);
    return nx;
  }
  function dropPantryRaw(id) {
    var cur = pantryItem(id);
    if (!cur) return;
    data.tombs[id] = Math.max(data.tombs[id] || 0, now(), cur.m);
    data.pa = data.pa.filter(function (i) { return i.id !== id; });
  }
  // Undo for pantry changes: snap = { id: copy before | null (was new) }.
  function snapPantry(ids, snap) {
    snap = snap || {};
    ids.forEach(function (id) { if (!(id in snap)) snap[id] = pantryItem(id) ? clone(pantryItem(id)) : null; });
    return snap;
  }
  function restorePantry(snap) {
    Object.keys(snap).forEach(function (id) {
      var prev = snap[id], cur = pantryItem(id);
      if (prev) {
        var x = clone(prev);
        x.m = Math.max(bump(cur ? cur.m : prev.m), (data.tombs[id] || 0) + 1);   // newer than any tomb (R17)
        data.pa = data.pa.filter(function (i) { return i.id !== id; });
        data.pa.push(x);
      } else if (cur) dropPantryRaw(id);
    });
    commit();
    renderPantryViews();
  }
  function renderPantryViews() { renderPantry(); renderShop(); }
  // A draft { n, q, u, l?, bb?, bc? } into the pantry. merge: an item
  // with the same name, no best-before and a unit that adds up takes
  // the amount instead. → { id, prev } or null. No commit.
  function addDraftRaw(d, merge) {
    if (merge && d.q !== null && d.q !== undefined && !d.bb) {
      var k = C.keyOf(d.n);
      for (var i = 0; i < data.pa.length; i++) {
        var it = data.pa[i];
        if (it.bb || C.keyOf(it.n) !== k) continue;
        var nq = P.addInto(it, d.q, d.u || "pc");
        if (nq === null) continue;
        var prev = clone(it), x = clone(it);
        x.q = nq;
        var w = putPantryRaw(x);
        return w ? { id: w.id, prev: prev, item: w, merged: true } : null;
      }
    }
    var r = putPantryRaw({ n: d.n, q: d.q === undefined ? null : d.q, u: d.u || "", l: d.l || P.guessLoc(d.n), bb: d.bb || "", bc: d.bc || "" });
    return r ? { id: r.id, prev: null, item: r } : null;
  }
  function addedToast(res) {
    var snap = {};
    snap[res.id] = res.prev;
    var msg = res.merged ? t("pa.more", { name: res.item.n, q: fmtPaQty(res.item) }) : t("pa.added", { name: res.item.n });
    undoToast(msg, function () { restorePantry(snap); });
  }
  function quickAdd(text) {
    var ing = C.parseIngLine(text, "");
    if (!ing) return false;
    var res = addDraftRaw({ n: ing.n, q: ing.q, u: ing.u || (ing.q !== null ? "pc" : "") }, true);
    if (!res) return false;
    commit();
    renderPantryViews();
    addedToast(res);
    return true;
  }

  // Shopping → pantry: a ticked line (or all of them). The tick (or the
  // manual item) remembers it went in (p: 1), so "Ticked to pantry"
  // never adds a line twice.
  function markShopPa(it) {
    if (it.manual) {
      data.mn.forEach(function (m) { if (m.id === it.key && m.p !== 1) { m.p = 1; m.m = bump(m.m); } });
    } else {
      var k = view.wk + "|" + it.key, cur = data.ck[k];
      if (cur && cur.p === 1) return;
      data.ck[k] = { v: cur ? cur.v : 1, m: bump(cur ? cur.m : 0), p: 1 };
    }
  }
  function shopDraft(it) {
    if (it.manual) {
      var ing = C.parseIngLine(it.name, "");
      return ing ? { n: ing.n, q: ing.q, u: ing.u || (ing.q !== null ? "pc" : "") } : { n: it.name, q: null, u: "" };
    }
    return P.fromShop(it);
  }
  function shopToPantry(list) {
    var snap = {}, n = 0, last = null;
    list.forEach(function (it) {
      var res = addDraftRaw(shopDraft(it), true);
      if (!res) return;
      if (!(res.id in snap)) snap[res.id] = res.prev;
      markShopPa(it);
      n++; last = res;
    });
    if (!n) return;
    commit();
    renderPantryViews();
    if (n === 1) addedToast(last);
    else undoToast(t("sh.allIn", { n: n }), function () { restorePantry(snap); });
  }
  function tickedToPantry() {
    var l = shopList();
    var list = l.items.concat(l.home).filter(function (it) { return it.done && !it.pa; });
    if (!list.length) { showToast(t("sh.noneTicked")); return; }
    shopToPantry(list);
  }

  // Render ------------------------------------------------------------
  function fmtPaQty(it) { return fmtAmt(it.q, it.u); }
  function fmtAmt(q, u) { return q === null ? "" : C.fmtIngQty(P.niceAmount(q, u), LANG, 1, prefs.un); }
  function fmtDate(ymd) {
    var d = new Date(ymd + "T12:00:00"), o = { day: "numeric", month: "short" };
    if (ymd.slice(0, 4) !== today().slice(0, 4)) o.year = "numeric";
    try { return new Intl.DateTimeFormat(LOCALE, o).format(d); } catch (e) { return ymd; }
  }
  function bbInfo(it) {
    if (!it.bb) return null;
    var d = P.daysLeft(it.bb, today());
    if (d < 0) return { txt: t("pa.expired", { d: fmtDate(it.bb) }), cls: "bad" };
    if (d === 0) return { txt: t("pa.today"), cls: "bad" };
    if (d === 1) return { txt: t("pa.tomorrow"), cls: "soon" };
    if (d <= 3) return { txt: t("pa.days", { n: d }), cls: "soon" };
    return { txt: t("pa.bbIn", { d: fmtDate(it.bb) }), cls: "" };
  }
  function paRow(it, showLoc) {
    var li = el("li", "pa-item");
    var b = el("button", "pa-open");
    b.type = "button";
    var main = el("span", "pa-main");
    main.appendChild(el("span", "pa-name", it.n));
    var q = fmtPaQty(it);
    if (q) main.appendChild(el("b", "pa-qty", q));
    b.appendChild(main);
    var sub = [];
    if (showLoc) sub.push(t("loc." + it.l));
    var bb = bbInfo(it);
    var meta = el("span", "pa-meta");
    if (sub.length) meta.appendChild(el("span", "", sub.join(" · ")));
    if (bb) meta.appendChild(el("span", "pa-bb " + bb.cls, bb.txt));
    if (meta.childNodes.length) b.appendChild(meta);
    b.setAttribute("aria-label", t("pa.edit", { name: it.n }) + (q ? ", " + q : "") + (bb ? ", " + bb.txt : ""));
    b.addEventListener("click", function () { openPantryEditor(it); });
    li.appendChild(b);
    return li;
  }
  function sortByName(list) {
    return list.slice().sort(function (a, b) { return C.fold(a.n).localeCompare(C.fold(b.n), LANG) || (a.id < b.id ? -1 : 1); });
  }
  function renderPantry() {
    var box = $("pa-list"), fl = $("pa-filters");
    var scroll = $("view-pa").scrollTop;
    fl.innerHTML = "";
    fl.setAttribute("aria-label", t("pe.loc"));
    [""].concat(C.LOCS).forEach(function (l) {
      var n = l ? data.pa.filter(function (i) { return i.l === l; }).length : data.pa.length;
      var b = el("button", "chip small" + (prefs.loc === l ? " on" : ""), (l ? t("loc." + l) : t("loc.all")) + " " + n);
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.loc === l ? "true" : "false");
      b.addEventListener("click", function () { prefs.loc = l; savePrefs(); renderPantry(); });
      fl.appendChild(b);
    });
    // Use soon: past or within 3 days, whatever the filter.
    var soon = P.expiring(data.pa, today(), 3), sb = $("pa-soon");
    sb.innerHTML = "";
    sb.hidden = !soon.length;
    if (soon.length) {
      sb.appendChild(el("h3", "aisle-h warn-h", "⏳ " + t("pa.soon")));
      var su = el("ul", "pa-ul");
      soon.forEach(function (it) { su.appendChild(paRow(it, true)); });
      sb.appendChild(su);
    }
    box.innerHTML = "";
    var shown = 0;
    C.LOCS.forEach(function (l) {
      if (prefs.loc && prefs.loc !== l) return;
      var list = sortByName(data.pa.filter(function (i) { return i.l === l; }));
      if (!list.length) return;
      box.appendChild(el("h3", "aisle-h", t("loc." + l)));
      var ul = el("ul", "pa-ul");
      list.forEach(function (it) { ul.appendChild(paRow(it, false)); });
      box.appendChild(ul);
      shown += list.length;
    });
    $("pa-empty").hidden = shown > 0;
    $("pa-empty").textContent = data.pa.length ? t("pa.emptyLoc") : t("pa.empty");
    $("view-pa").scrollTop = scroll;
  }

  // Editor -------------------------------------------------------------
  var PA_UNITS = ["pc", "g", "kg", "ml", "l", "pack", "can", "bunch", "slice", "oz", "lb"];
  function unitName(u) { return u === "pc" ? t("u.pc") : C.unitLabel(u, 2, LANG); }
  // it: a stored item, or a draft (no id). opts.off: an Open Food Facts
  // product the draft came from (its values are remembered for that
  // ingredient when nothing is yet).
  function openPantryEditor(it, opts) {
    opts = opts || {};
    var stored = it && it.id ? pantryItem(it.id) : null;
    var src = Object.assign({}, stored || it || {});
    if (src.q !== null && src.q !== undefined) { var na = P.niceAmount(src.q, src.u); src.q = na.q; src.u = na.u; }
    var dlg = makeDialog("ml-pe");
    dlg.appendChild(el("div", "dlg-title", t(stored ? "pe.edit" : "pe.new")));
    var form = el("form", "edit-form");
    form.method = "dialog";
    var fName = el("input");
    fName.maxLength = C.LIM.ingName; fName.autocomplete = "off"; fName.value = src.n || "";
    form.appendChild(labeled(t("pe.name"), fName));
    var row = el("div", "fld-row");
    var fQ = el("input");
    fQ.type = "number"; fQ.min = "0"; fQ.step = "any"; fQ.inputMode = "decimal";
    fQ.value = src.q === null || src.q === undefined ? "" : String(src.q);
    var fU = el("select");
    var units = PA_UNITS.slice();
    if (src.u && units.indexOf(src.u) < 0) units.push(src.u);
    units.forEach(function (u) {
      var o = el("option", "", unitName(u));
      o.value = u;
      if ((src.u || "pc") === u) o.selected = true;
      fU.appendChild(o);
    });
    var initQU = fQ.value + "|" + fU.value;
    var wq = labeled(t("pe.qty"), fQ); wq.classList.add("narrow");
    row.appendChild(wq);
    row.appendChild(labeled(t("pe.unit"), fU));
    form.appendChild(row);
    var locSet = el("fieldset", "");
    locSet.appendChild(el("legend", "dlg-lbl", t("pe.loc")));
    var locRow = el("div", "seg");
    var loc = src.l || P.guessLoc(src.n || "");
    var locBtns = [];
    C.LOCS.forEach(function (l) {
      var b = el("button", "chip small" + (loc === l ? " on" : ""), t("loc." + l));
      b.type = "button";
      b.setAttribute("aria-pressed", loc === l ? "true" : "false");
      b.addEventListener("click", function () {
        loc = l;
        locBtns.forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      });
      locBtns.push(b);
      locRow.appendChild(b);
    });
    locSet.appendChild(locRow);
    form.appendChild(locSet);
    var row2 = el("div", "fld-row");
    var fBb = el("input");
    fBb.type = "date"; fBb.value = src.bb || "";
    row2.appendChild(labeled(t("pe.bb"), fBb));
    var fBc = el("input");
    fBc.inputMode = "numeric"; fBc.maxLength = 14; fBc.autocomplete = "off"; fBc.value = src.bc || "";
    row2.appendChild(labeled(t("pe.bc"), fBc));
    form.appendChild(row2);
    var acts = el("div", "dlg-actions wrap");
    if (stored) acts.appendChild(button(t("pe.del"), "danger", function () {
      var snap = snapPantry([stored.id]);
      dropPantryRaw(stored.id);
      commit();
      dlg.close();
      renderPantryViews();
      undoToast(t("pa.removed"), function () { restorePantry(snap); });
    }));
    acts.appendChild(button(t("e.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("pe.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = C.clean(fName.value, C.LIM.ingName);
      if (!n) { showToast(t("pe.needName")); fName.focus(); return; }
      var q = Number(String(fQ.value).replace(",", "."));
      var bc = fBc.value.replace(/\D/g, "");
      var x = { n: n, q: fQ.value !== "" && q > 0 ? q : null, u: fU.value, l: loc, bb: C.validYmd(fBb.value) ? fBb.value : "", bc: C.BC_RE.test(bc) ? bc : "" };
      if (stored) {
        x.id = stored.id;
        if (fQ.value + "|" + fU.value === initQU) { x.q = stored.q; x.u = stored.u; }   // shown as 970 ml, kept as 0.97 l (R27)
      }
      var snap = stored ? snapPantry([stored.id]) : {};
      var w = putPantryRaw(x);
      if (!w) return;
      if (!stored) snap[w.id] = null;
      var off = opts.off, k = C.keyOf(n);
      if (off && off.v && k && !data.nu[k]) setNuRaw(k, { s: "off", c: off.code, nm: off.name, k: off.v.k, p: off.v.p, cb: off.v.cb, f: off.v.f });
      commit();
      dlg.close();
      renderPantryViews();
      if (!stored) undoToast(t("pa.added", { name: w.n }), function () { restorePantry(snap); });
    });
    dlg.appendChild(form);
    showDialog(dlg);
    if (!stored && !coarse()) fName.focus();
  }

  // Barcode --------------------------------------------------------------
  // The camera reads like Stock's (stock/stock.js §9b): BarcodeDetector
  // where the browser has it (Chrome on Android), else the number is
  // typed. The product is looked up on Open Food Facts only on a read
  // or on "Look up"; a code already in the pantry needs no network.
  var CAM_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
  function camOk() {
    return typeof window.BarcodeDetector === "function" &&
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }
  function fetchJSON(url) {
    if (navigator.onLine === false) return Promise.reject({ code: "offline" });
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var tm = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) {
        clearTimeout(tm);
        if (r.status === 404) return r.json().catch(function () { return null; });
        if (!r.ok) throw { code: "http " + r.status };
        return r.json();
      }, function (e) {
        clearTimeout(tm);
        throw { code: e && e.name === "AbortError" ? "timeout" : (navigator.onLine === false ? "offline" : "net") };
      });
  }
  function netMsg(e) { return e && e.code === "offline" ? t("net.offline") : t("net.err", { code: (e && e.code) || "net" }); }
  function per100(v) {
    var r = function (x) { return fmtNum(x, x < 10 ? 1 : 0); };
    return t("bc.per100", { k: r(v.k), p: r(v.p), c: r(v.cb), f: r(v.f) });
  }
  function fmtNum(v, dec) {
    try { return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: dec || 0 }).format(v); } catch (e) { return String(Math.round(v)); }
  }
  function offLink(code) {
    var a = el("a", "src-link", t("bc.page"));
    a.href = N.offPageUrl(code);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function openBarcode() {
    var dlg = makeDialog("ml-bc");
    dlg.appendChild(el("div", "dlg-title", t("bc.title")));
    var video = null, stream = null, timer = 0, stopped = false, det = null;
    var camMsg = el("p", "hint cam-msg");
    camMsg.setAttribute("aria-live", "polite");
    if (camOk()) {
      video = el("video", "cam-video");
      video.muted = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-hidden", "true");
      dlg.appendChild(video);
      dlg.appendChild(camMsg);
    }
    var row = el("div", "add-row");
    var inp = el("input");
    inp.inputMode = "numeric"; inp.maxLength = 20; inp.autocomplete = "off";
    inp.placeholder = t("bc.code");
    inp.setAttribute("aria-label", t("bc.code"));
    inp.setAttribute("enterkeyhint", "search");
    row.appendChild(inp);
    var look = button(t("bc.look"), "primary", function () { lookUp(inp.value); });
    row.appendChild(look);
    dlg.appendChild(row);
    var status = el("p", "im-status");
    status.setAttribute("role", "status");
    status.hidden = true;
    dlg.appendChild(status);
    var res = el("div", "bc-res");
    dlg.appendChild(res);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("v.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); lookUp(inp.value); } });
    dlg.addEventListener("close", stopCam);
    var asked = 0;
    function say(msg, bad) { status.hidden = !msg; status.textContent = msg || ""; status.classList.toggle("bad", !!bad); }
    function stopCam() {
      stopped = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      stream = null;
      if (video) { try { video.srcObject = null; } catch (e) {} video.hidden = true; camMsg.hidden = true; }
    }
    function lookUp(raw) {
      var code = String(raw || "").replace(/\D/g, "");
      inp.value = code;
      res.innerHTML = "";
      if (!N.validBarcode(code)) { say(t("bc.bad"), true); return; }
      stopCam();
      var known = P.findByCode(data.pa, code);
      if (known) {
        say("");
        res.appendChild(el("p", "item-name", t("bc.known", { name: known.n })));
        var kr = el("div", "dlg-actions wrap");
        kr.appendChild(button(t("bc.add"), "primary", function () {
          dlg.close();
          openPantryEditor({ n: known.n, q: known.q, u: known.u, l: known.l, bb: "", bc: code });
        }));
        res.appendChild(kr);
        return;
      }
      var my = ++asked;
      say(t("bc.looking"));
      look.disabled = true;
      fetchJSON(N.offProductUrl(code)).then(function (json) {
        if (my !== asked || !dlg.open) return;
        look.disabled = false;
        var p = N.parseOffProduct(json, LANG);
        say("");
        if (!p) {
          res.appendChild(el("p", "hint", t("bc.notFound")));
          var nr = el("div", "dlg-actions wrap");
          nr.appendChild(button(t("bc.addName"), "primary", function () { dlg.close(); openPantryEditor({ n: "", bc: code }); }));
          res.appendChild(nr);
          return;
        }
        res.appendChild(el("p", "item-name", p.name + (p.brand ? " · " + p.brand : "") + (p.qty ? " · " + p.qty : "")));
        if (p.v) res.appendChild(el("p", "hint", per100(p.v)));
        res.appendChild(offLink(p.code || code));
        var ar = el("div", "dlg-actions wrap");
        ar.appendChild(button(t("bc.add"), "primary", function () {
          var pq = N.parseQuantity(p.qty);
          dlg.close();
          openPantryEditor({ n: C.clean(p.name, C.LIM.ingName), q: pq ? pq.q : null, u: pq ? pq.u : "", l: P.guessLoc(p.name), bc: code }, { off: p });
        }));
        res.appendChild(ar);
      }, function (e) {
        if (my !== asked || !dlg.open) return;
        look.disabled = false;
        say(netMsg(e), true);
      });
    }
    showDialog(dlg);
    if (!video) { camMsg.hidden = true; if (!coarse()) inp.focus(); return; }
    try { det = new window.BarcodeDetector({ formats: CAM_FORMATS }); }
    catch (e) { try { det = new window.BarcodeDetector(); } catch (e2) { det = null; } }
    function camFail() { camMsg.textContent = t("bc.camOff"); if (video) video.hidden = true; }
    if (!det) { camFail(); return; }
    camMsg.textContent = t("bc.cam");
    function loop() {
      if (stopped) return;
      if (video.readyState < 2) { timer = setTimeout(loop, 200); return; }
      det.detect(video).then(function (list) {
        if (stopped) return;
        var raw = list && list[0] && typeof list[0].rawValue === "string" ? list[0].rawValue.replace(/\D/g, "") : "";
        if (raw && N.validBarcode(raw)) {
          try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
          lookUp(raw);
          return;
        }
        timer = setTimeout(loop, 150);
      }, function () { timer = setTimeout(loop, 400); });
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (st) {
      if (stopped) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      stream = st;
      video.srcObject = st;
      return video.play().then(loop);
    }).catch(function () { if (!stopped) camFail(); });
  }

  // What can I cook ------------------------------------------------------
  function openCookable() {
    var dlg = makeDialog("ml-cookable", "wide");
    var head = el("div", "v-head");
    head.appendChild(el("h2", "v-title", t("ck.title")));
    head.appendChild(closeBtn(dlg));
    dlg.appendChild(head);
    dlg.appendChild(el("p", "hint", t("ck.hint")));
    var list = P.cookable(recipes(), data.pa, function (k) { return C.inPantry(data, k); }, today()).slice(0, 40);
    if (!list.length) dlg.appendChild(el("p", "empty", t("ck.none")));
    var ul = el("ul", "ck-list");
    list.forEach(function (e) {
      var r = e.r;
      var li = el("li", "ck-card");
      var top = el("div", "ck-top");
      top.appendChild(el("span", "rc-emoji small", r.e || "🍽️"));
      var body = el("div", "rc-body");
      body.appendChild(el("span", "rc-title", r.t));
      body.appendChild(el("span", "rc-meta" + (e.missing.length ? "" : " ok"),
        e.missing.length ? t("ck.have", { h: e.have, n: e.total }) : "✓ " + t("ck.all")));
      if (e.missing.length) body.appendChild(el("span", "ck-miss", t("ck.missing", { list: e.missing.map(function (i) { return i.n; }).join(", ") })));
      if (e.low.length) body.appendChild(el("span", "ck-low", t("ck.low", { list: e.low.map(function (i) { return i.n; }).join(", ") })));
      if (e.soon !== null && e.soon <= 3) body.appendChild(el("span", "pa-bb soon", "⏳ " + t("ck.soonUse")));
      top.appendChild(body);
      li.appendChild(top);
      var acts = el("div", "ck-acts");
      acts.appendChild(button(t("ck.open"), "small", function () { dlg.close(); openRecipe(r.id); }));
      if (e.missing.length) {
        var add = button(t("ck.addMissing"), "small", function () {
          var n = addManualMany(e.missing.map(function (i) { return C.ingToLine(i, LANG, 1, prefs.un).replace(/, .*$/, ""); }), thisWeek());
          add.disabled = true;
          showToast(t("ck.addedMissing", { n: n }));
        });
        acts.appendChild(add);
      }
      li.appendChild(acts);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    showDialog(dlg);
  }
  // Several extras at once (one commit); one already on that week's list is skipped.
  function addManualMany(texts, wk) {
    var have = {}, n = 0;
    data.mn.forEach(function (m) { if (m.w === wk) have[C.fold(m.t)] = 1; });
    texts.forEach(function (text) {
      var tx = C.clean(text, C.LIM.manual);
      if (!tx || have[C.fold(tx)]) return;
      have[C.fold(tx)] = 1;
      var r = new Uint32Array(1);
      crypto.getRandomValues(r);
      data.mn.push({ id: "n" + C.compactYmd(wk) + "-" + now().toString(36) + r[0].toString(36).slice(0, 4) + n, m: now(), w: wk, t: tx, d: 0 });
      n++;
    });
    if (n) { commit(); renderShop(); }
    return n;
  }

  // Cooked: take from the pantry --------------------------------------
  function openCooked(id, sv) {
    var r = getRecipe(id);
    if (!r) return;
    sv = sv || r.sv;
    var plan = P.cookPlan(r, sv / r.sv, data.pa, today());
    if (!plan.some(function (p) { return p.st !== "none"; })) { showToast(t("co.nothing")); return; }
    var dlg = makeDialog("ml-cooked", "wide");
    dlg.appendChild(el("div", "dlg-title", t("co.title")));
    dlg.appendChild(el("p", "item-name", (r.e || "🍽️") + " " + r.t + " · " + t("share.serv", { n: sv })));
    dlg.appendChild(el("p", "hint", t("co.hint")));
    var ul = el("ul", "co-list"), boxes = [];
    plan.forEach(function (p) {
      var li = el("li", "co-item" + (p.st === "none" ? " off" : ""));
      if (p.st === "none") {
        li.appendChild(el("span", "co-name", p.ing.n));
        li.appendChild(el("span", "hint", t("co.notIn")));
        ul.appendChild(li);
        return;
      }
      var lab = el("label", "check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = p.st === "take";
      lab.appendChild(cb);
      var txt = el("span", "co-txt");
      txt.appendChild(el("span", "co-name", p.ing.n));
      if (p.st === "take") {
        p.takes.forEach(function (tk) {
          var it = pantryItem(tk.id);
          // One item: the recipe's own amount ("2 tbsp"); several: each item's share.
          var take = p.takes.length === 1 && !p.short ? C.fmtIngQty({ q: p.ing.q * sv / r.sv, u: p.ing.u }, LANG, 1, prefs.un) : fmtAmt(tk.take, it.u);
          var line = tk.left > 0.0005
            ? t("co.line", { take: take, have: fmtPaQty(it), left: fmtAmt(tk.left, it.u) })
            : t("co.gone", { take: take });
          txt.appendChild(el("span", "hint", (C.fold(it.n) === C.fold(p.ing.n) ? "" : it.n + ": ") + line));
        });
        if (p.short) txt.appendChild(el("span", "warn", t("co.short", { n: fmtAmt(p.short, p.ing.u) })));
      } else {
        var it0 = pantryItem(p.takes[0].id);
        txt.appendChild(el("span", "hint", t("co.usedUp", { name: it0.n + (fmtPaQty(it0) ? " " + fmtPaQty(it0) : "") })));
      }
      lab.appendChild(txt);
      li.appendChild(lab);
      ul.appendChild(li);
      boxes.push({ cb: cb, p: p });
    });
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("e.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("co.ok"), "primary", function () {
      var snap = {}, changed = 0;
      boxes.forEach(function (b) {
        if (!b.cb.checked) return;
        b.p.takes.forEach(function (tk) {
          var cur = pantryItem(tk.id);
          if (!cur) return;
          snapPantry([tk.id], snap);
          if (tk.take === null || cur.q === null) { dropPantryRaw(tk.id); changed++; return; }
          var left = Math.round((cur.q - tk.take) * 1000) / 1000;
          if (left <= 0.0005) dropPantryRaw(tk.id);
          else { var x = clone(cur); x.q = left; putPantryRaw(x); }
          changed++;
        });
      });
      dlg.close();
      if (!changed) return;
      commit();
      renderPantryViews();
      undoToast(t("co.done"), function () { restorePantry(snap); });
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // Nutrition ----------------------------------------------------------
  function setNuRaw(k, entry) {
    var cur = data.nu[k];
    var x = C.normNu(Object.assign({}, entry, { m: 1 }));
    if (!x) return false;
    if (cur) { var a = clone(cur); a.m = 1; if (JSON.stringify(a) === JSON.stringify(x)) return false; }
    x.m = bump(cur ? cur.m : 0);
    data.nu[k] = x;
    return true;
  }
  function estText(per) {
    var r = function (x) { return fmtNum(x, 0); };
    return t("nu.est", { k: r(per.k), p: r(per.p), c: r(per.cb), f: r(per.f) });
  }
  // The box in the recipe view; redraws itself after a match changes.
  function nutritionBox(r) {
    var box = el("div", "nu-box");
    function draw() {
      box.innerHTML = "";
      var e = N.recipeNutrition(r, data.nu);
      box.appendChild(el("h3", "sec-h", t("nu.title")));
      if (e.any) {
        box.appendChild(el("p", "nu-est", estText(e.per)));
        var total = e.rows.filter(function (x) { return x.st !== "x"; }).length;
        box.appendChild(el("p", "hint", t("nu.counted", { n: e.counted, m: total })));
      } else box.appendChild(el("p", "hint", t("nu.none")));
      box.appendChild(button(t("nu.check"), "small", function () { openNutrition(r, draw); }));
    }
    draw();
    return box;
  }
  function nuStatus(row) {
    if (row.st === "ok") {
      var src = row.src === "off" ? t("nu.src.off") + (row.name ? ": " + row.name : "") : t("nu.src.tbl") + ": " + tblName(N.rowById(row.name));
      return t("nu.st.ok", { g: fmtNum(row.g, 0), src: src });
    }
    return t("nu.st." + row.st);
  }
  function tblName(row) { return row ? (LANG === "el" ? row.el : row.en) : ""; }
  function openNutrition(r, onChange) {
    var dlg = makeDialog("ml-nu", "wide");
    var head = el("div", "v-head");
    head.appendChild(el("h2", "v-title", t("nu.dlg")));
    head.appendChild(closeBtn(dlg));
    dlg.appendChild(head);
    dlg.appendChild(el("p", "item-name", (r.e || "🍽️") + " " + r.t));
    var sum = el("p", "nu-est");
    dlg.appendChild(sum);
    dlg.appendChild(el("p", "hint", t("nu.dlgHint")));
    var ul = el("ul", "nu-list");
    dlg.appendChild(ul);
    function draw() {
      var e = N.recipeNutrition(r, data.nu);
      sum.textContent = e.any ? t("nu.title") + ": " + estText(e.per) : t("nu.none");
      ul.innerHTML = "";
      e.rows.forEach(function (row) {
        var li = el("li", "nu-row" + (row.st === "ok" ? "" : " gap"));
        var txt = el("span", "nu-txt");
        txt.appendChild(el("span", "", C.ingToLine(row.ing, LANG, 1, prefs.un)));
        txt.appendChild(el("span", "hint", nuStatus(row)));
        li.appendChild(txt);
        var b = button(t("nu.change"), "small", function () {
          openMatch(row.ing, function () { draw(); if (onChange) onChange(); renderWeek(); });
        });
        b.setAttribute("aria-label", t("nu.match", { name: row.ing.n }));
        li.appendChild(b);
        ul.appendChild(li);
      });
    }
    draw();
    dlg.appendChild(el("p", "hint nu-credit", t("nu.credit")));
    showDialog(dlg);
  }
  function openMatch(ing, onDone) {
    var k = C.keyOf(ing.n);
    if (!k) return;
    var cur = data.nu[k] || null, auto = N.findBuiltIn(ing.n);
    var dlg = makeDialog("ml-match", "wide");
    dlg.appendChild(el("div", "dlg-title", t("nu.match", { name: ing.n })));
    function save(entry) {
      var gv = Number(String(fG.value).replace(",", "."));
      if (entry.s !== "x" && gv > 0) entry.g = gv;
      if (setNuRaw(k, entry)) commit();
      dlg.close();
      showToast(t("nu.saved", { name: ing.n }));
      onDone();
    }
    // Grams in one piece (for "2 onions", "1 pack").
    var fG = el("input");
    fG.type = "number"; fG.min = "0"; fG.step = "any"; fG.inputMode = "decimal";
    fG.value = cur && cur.g ? String(cur.g) : "";
    var gw = labeled(t("nu.pieceG"), fG);
    gw.classList.add("narrow");
    var pieceUnit = !ing.u || ing.u === "pc" || ing.u === "pack" || ing.u === "slice";
    if (pieceUnit) dlg.appendChild(gw);
    // Built-in table
    var tr = el("div", "add-row");
    var sel = el("select");
    sel.setAttribute("aria-label", t("nu.useTbl"));
    var rowsAll = N.rows().sort(function (a, b) { return C.fold(tblName(a)).localeCompare(C.fold(tblName(b)), LANG); });
    var selId = cur && cur.s === "tbl" ? cur.t : (auto ? auto.id : "");
    rowsAll.forEach(function (row) {
      var o = el("option", "", tblName(row) + " · " + fmtNum(row.k, 0) + " kcal");
      o.value = row.id;
      if (row.id === selId) o.selected = true;
      sel.appendChild(o);
    });
    tr.appendChild(sel);
    tr.appendChild(button(t("pk.addText"), "", function () { save({ s: "tbl", t: sel.value }); }));
    dlg.appendChild(el("p", "dlg-lbl", t("nu.useTbl")));
    dlg.appendChild(tr);
    // Open Food Facts
    dlg.appendChild(el("p", "dlg-lbl", t("nu.search")));
    var sr = el("div", "add-row");
    var q = el("input");
    q.type = "search"; q.maxLength = 80; q.autocomplete = "off"; q.value = ing.n;
    q.setAttribute("aria-label", t("nu.search"));
    var go = button(t("bc.look"), "primary", search);
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });
    sr.appendChild(q); sr.appendChild(go);
    dlg.appendChild(sr);
    var status = el("p", "im-status");
    status.setAttribute("role", "status");
    status.hidden = true;
    dlg.appendChild(status);
    var res = el("div", "pick-list off-res");
    dlg.appendChild(res);
    var asked = 0;
    function say(msg, bad) { status.hidden = !msg; status.textContent = msg || ""; status.classList.toggle("bad", !!bad); }
    function search() {
      var term = C.clean(q.value, 80);
      if (!term) { q.focus(); return; }
      var my = ++asked;
      res.innerHTML = "";
      say(t("nu.searching"));
      go.disabled = true;
      fetchJSON(N.offSearchUrl(term, LANG)).then(function (json) {
        if (my !== asked || !dlg.open) return;
        go.disabled = false;
        var list = N.parseOffSearch(json, LANG);
        say(list.length ? "" : t("nu.noRes"), !list.length);
        list.forEach(function (p) {
          var b = el("button", "pick-row");
          b.type = "button";
          var body = el("span", "rc-body");
          body.appendChild(el("span", "rc-title", p.name + (p.brand ? " · " + p.brand : "")));
          body.appendChild(el("span", "rc-meta", per100(p.v)));
          b.appendChild(body);
          b.addEventListener("click", function () {
            save({ s: "off", c: p.code, nm: C.clean(p.name + (p.brand ? " · " + p.brand : ""), C.LIM.offName), k: p.v.k, p: p.v.p, cb: p.v.cb, f: p.v.f });
          });
          res.appendChild(b);
        });
      }, function (e) {
        if (my !== asked || !dlg.open) return;
        go.disabled = false;
        say(netMsg(e), true);
      });
    }
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("nu.leaveOut"), "", function () { save({ s: "x" }); }));
    acts.appendChild(button(t("v.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dlg.appendChild(el("p", "hint nu-credit", t("nu.credit")));
    showDialog(dlg);
  }
  // The week: one serving of each planned recipe, per person per day.
  function dayKcal(d, cache) {
    if (!prefs.nu) return null;
    var cells = data.set.sl.map(function (s) { return data.pl[cellKey(d, s)]; }).filter(Boolean);
    if (!cells.length) return null;
    var e = N.dayNutrition(cells, getRecipe, data.nu, cache);
    if (!e.n) return null;
    var k = fmtNum(e.sum.k, 0);
    return { txt: t("nu.kcal", { k: k }), title: t(e.partial ? "nu.dayPart" : "nu.day", { k: k }) + " · " + estText(e.sum) };
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

    var un = el("fieldset", "");
    un.appendChild(el("legend", "dlg-lbl", t("s.units")));
    un.appendChild(el("p", "hint", t("s.unitsHint")));
    un.appendChild(unitsSeg(function () {}));
    dlg.appendChild(un);

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

    // Pantry reminder + nutrition (wave 3): device-local prefs.
    var ntSet = el("fieldset", "");
    ntSet.appendChild(el("legend", "dlg-lbl", t("s.nt")));
    ntSet.appendChild(el("p", "hint", t("s.ntHint")));
    var ntSel = el("select");
    ntSel.setAttribute("aria-label", t("s.nt"));
    [-1, 7, 8, 9, 12, 18, 20].forEach(function (h) {
      var o = el("option", "", h < 0 ? t("s.ntOff") : t("s.ntAt", { h: ("0" + h).slice(-2) }));
      o.value = String(h);
      if (prefs.nt === h) o.selected = true;
      ntSel.appendChild(o);
    });
    if (ntSel.selectedIndex < 0) ntSel.value = "-1";
    ntSel.addEventListener("change", function () { prefs.nt = Number(ntSel.value); savePrefs(); });
    ntSet.appendChild(ntSel);
    dlg.appendChild(ntSet);
    var nuSet = el("fieldset", "");
    nuSet.appendChild(el("legend", "dlg-lbl", t("s.credits")));
    var nuL = el("label", "check");
    var nuCb = el("input"); nuCb.type = "checkbox"; nuCb.checked = !!prefs.nu;
    nuCb.addEventListener("change", function () { prefs.nu = nuCb.checked ? 1 : 0; savePrefs(); renderWeek(); });
    nuL.appendChild(nuCb); nuL.appendChild(el("span", "", t("s.nu")));
    nuSet.appendChild(nuL);
    nuSet.appendChild(el("p", "hint", t("nu.credit")));
    dlg.appendChild(nuSet);

    var bk = el("fieldset", "");
    bk.appendChild(el("legend", "dlg-lbl", t("s.backup")));
    var brow = el("div", "dlg-actions wrap");
    brow.appendChild(button(t("s.export"), "", exportBackup));
    brow.appendChild(button(t("s.import"), "", importBackup));
    bk.appendChild(brow);
    dlg.appendChild(bk);

    // .orosmeals (OBF-4e): save / open an orOS file, open as a copy
    if (recFile) {
      var of = el("fieldset", "");
      of.id = "s-ofile";
      of.appendChild(el("legend", "dlg-lbl", t("s.file")));
      var orow = el("div", "dlg-actions wrap");
      [["s-osave", "file.save", function () { recFile.save(); }],
       ["s-oopen", "file.open", function () { recFile.open(); }],
       ["s-ocopy", "file.copy", function () { if (recCopy) recCopy.open(); }],
       ["s-ofolder", "file.folder", function () { recFile.openFolder(); }]].forEach(function (b) {
        var btn = button(t(b[1]), "", function () { dlg.close(); b[2](); });
        btn.id = b[0];
        orow.appendChild(btn);
      });
      of.appendChild(orow);
      of.appendChild(el("p", "hint", t("file.copyHint")));
      dlg.appendChild(of);
    }
    showDialog(dlg);
  }

  // .orosmeals (OBF-4e): the recipes, the plan, the shopping ticks and
  // own items, the pantry and the "always at home" choices as one orOS
  // file (../recordpkg.js + package.js). Opening ADDS what this device
  // lacks, with its ids; a record already here (or deleted here) is
  // kept as it is unless "Update with newer versions" is ticked. The
  // result goes through commit() (mergeMeals + save + sync dirty);
  // Undo takes the added records back the app's own way: tombstones for
  // recipes, own items and pantry items, a newer empty cell for a plan
  // cell, a newer "off" for a tick or an "always at home" choice.
  // "Open as copy" (recCopy) adds the file's recipes under fresh ids:
  // recipes work like templates, so a recipe already here comes in as
  // a second one. Previews: recipes.md (recipeText) and shopping.txt
  // (shopAsText, the week on screen).
  var RP = window.OrosRecordPkg || null, MPK = window.OrosMealsPackage || null;
  var recAdded = null;                     // { rc: [ids], pl: [keys] … } of the last open
  var recFmt = {
    recipe: function (r) { return recipeText(r, r.sv); },
    shop: function () { return shopAsText(); }
  };
  function recHooks() {
    return {
      lang: function () { return LANG; },
      get: function () { return C.mergeMeals(data, data); },
      title: function () { return t("app.name"); },
      set: function (next, info) {
        if (!next || typeof next !== "object" || !Array.isArray(next.rc)) return;
        var before = C.mergeMeals(data, data);
        data = C.mergeMeals(next, next);
        commit();
        recAdded = MPK.addedByColl(before, data, info && info.addedIds);
        renderAll();
      },
      deleteIds: function (ids) {
        var want = {}, by = recAdded || {}, ts = now();
        ids.forEach(function (id) { want[id] = 1; });
        function each(k, fn) { (by[k] || []).forEach(function (id) { if (want[id]) fn(id); }); }
        each("rc", function (id) {
          var r = storedRecipe(id);
          if (!r) return;
          data.tombs[id] = Math.max(data.tombs[id] || 0, ts, r.m);
          data.rc = data.rc.filter(function (x) { return x.id !== id; });
        });
        each("mn", function (id) {
          var x = null;
          data.mn.forEach(function (m) { if (m.id === id) x = m; });
          if (!x) return;
          data.tombs[id] = Math.max(data.tombs[id] || 0, ts, x.m);
          data.mn = data.mn.filter(function (m) { return m.id !== id; });
        });
        each("pa", dropPantryRaw);
        each("pl", function (k) { if (data.pl[k]) setCellRaw(k, []); });
        each("ck", function (k) { var c = data.ck[k]; if (c && c.v) data.ck[k] = { v: 0, m: bump(c.m) }; });
        each("pn", function (k) {
          var c = data.pn[k];
          if (!c || !c.v) return;
          var x = { v: 0, m: bump(c.m) };
          if (c.n) x.n = c.n;
          data.pn[k] = x;
        });
        recAdded = null;
        commit();
        renderAll();
        showToast(RP.str(LANG, "undone"));
      },
      toast: function (text, undo) { if (undo) undoToast(text, undo); else showToast(text); }
    };
  }
  var recFile = RP && MPK && window.OrosBundle ? RP.ui(MPK.forLocal(function () { return data; }, recFmt), recHooks()) : null;
  var recCopy = recFile ? RP.ui(MPK.asCopy(function () { return data; }, recFmt, function () { return newId("r"); }), recHooks()) : null;

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
  // Same, with another action than Undo ("To pantry").
  function actionToast(text, label, fn) { localToast(text, fn, label); }
  var toastTimer = null;
  function localToast(text, onUndo, label) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", label || t("toast.undo"));
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
      else if (e.code === "Digit4") setTab("pa");
      else if (e.code === "KeyN") { e.preventDefault(); openEditor(null); }
      else if (e.code === "Slash") { e.preventDefault(); setTab("rc"); $("rc-search").focus(); }
      else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && (prefs.tab === "wk" || prefs.tab === "sh") && tag !== "BUTTON") {
        e.preventDefault(); shiftWeek(e.code === "ArrowLeft" ? -1 : 1);
      } else return;
    });
    // Tabs: arrow keys move between them (ARIA tabs pattern).
    $("tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      var order = TABS, i = order.indexOf(prefs.tab);
      i = (i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length;
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
    TABS.forEach(function (x) { $("tab-" + x).textContent = t("tab." + x); });
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
    $("wk-sheet").textContent = t("sheet.open");
    $("sh-from").textContent = t("sh.from");
    $("sh-copy").textContent = t("sh.copy");
    $("sh-share").textContent = t("sh.share");
    $("sh-todo").textContent = t("sh.todo");
    $("sh-sheet").textContent = t("sheet.open");
    $("sh-bud").textContent = t("bud.btn");
    $("sh-uncheck").textContent = t("sh.uncheck");
    $("sh-pantry").textContent = t("sh.tickedToPantry");
    $("pa-add-in").placeholder = t("pa.add");
    $("pa-add-in").setAttribute("aria-label", t("pa.add"));
    $("pa-add-btn").innerHTML = UI.plus;
    $("pa-add-btn").setAttribute("aria-label", t("pa.addBtn"));
    $("pa-scan").innerHTML = UI.barcode + "<span></span>";
    $("pa-scan").lastChild.textContent = t("pa.scan");
    $("pa-scan").setAttribute("aria-label", t("bc.title"));
    $("pa-scan").title = t("bc.title");
    $("pa-cook").textContent = t("pa.cook");
    $("sh-add-in").placeholder = t("sh.add");
    $("sh-add-in").setAttribute("aria-label", t("sh.add"));
    $("sh-add-btn").innerHTML = UI.plus;
    $("sh-add-btn").setAttribute("aria-label", t("sh.add"));
  }

  function wire() {
    TABS.forEach(function (x) {
      $("tab-" + x).addEventListener("click", function () { setTab(x); });
    });
    $("set-btn").addEventListener("click", openSettings);
    $("rc-search").addEventListener("input", function () { view.q = $("rc-search").value; renderRecipes(); });
    $("rc-new").addEventListener("click", function () { openEditor(null); });
    $("rc-paste").addEventListener("click", function () { openPaste(); });
    [].forEach.call(document.querySelectorAll(".wk-prev"), function (b) { b.addEventListener("click", function () { shiftWeek(-1); }); });
    [].forEach.call(document.querySelectorAll(".wk-next"), function (b) { b.addEventListener("click", function () { shiftWeek(1); }); });
    [].forEach.call(document.querySelectorAll(".wk-today"), function (b) { b.addEventListener("click", function () { shiftWeek(0); }); });
    $("wk-copy").addEventListener("click", copyLastWeek);
    $("wk-fill").addEventListener("click", fillGaps);
    $("wk-clear").addEventListener("click", clearWeek);
    $("wk-sheet").hidden = !shellOpenAt();
    $("wk-sheet").addEventListener("click", weekToSheet);
    $("sh-from").addEventListener("click", function () { prefs.from = prefs.from ? 0 : 1; savePrefs(); renderShop(); });
    $("sh-copy").addEventListener("click", function () { copyText(shopAsText()); });
    $("sh-share").addEventListener("click", function () { shareText(shopTitle(), shopAsText()); });
    $("sh-todo").hidden = !shellOpenAt();
    $("sh-todo").addEventListener("click", sendToTodo);
    $("sh-sheet").hidden = !shellOpenAt();
    $("sh-sheet").addEventListener("click", shopToSheet);
    $("sh-bud").hidden = !budgetBridge();
    $("sh-bud").addEventListener("click", shopToBudget);
    $("sh-uncheck").addEventListener("click", function () {
      var l = shopList();
      l.items.concat(l.home).forEach(function (it) { if (it.done) setTick(it, false); });
      renderShop();
    });
    $("sh-pantry").addEventListener("click", tickedToPantry);
    var paIn = $("pa-add-in");
    var paAdd = function () {
      if (!C.clean(paIn.value, 80)) { paIn.focus(); return; }
      if (quickAdd(paIn.value)) paIn.value = "";
      paIn.focus();
    };
    $("pa-add-btn").addEventListener("click", paAdd);
    paIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); paAdd(); } });
    $("pa-scan").addEventListener("click", openBarcode);
    $("pa-cook").addEventListener("click", openCookable);
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
      renderWeek(); renderShop(); renderPantry();
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
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("meals");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { recipe } → Recipes tab + the recipe; { day } → Week tab
  // at that day's week. Unknown recipe / bad day → no-op; an open
  // dialog → no-op (unsaved edits and cook mode win).
  // Target { addRecipe: {…} } ("Add to my orOS" from a shared link):
  // the recipe opens in the editor as a NEW draft, saved only on Save.
  function openSearchTarget(t) {
    // "Open with" an .orosmeals file (fileopen.js): { openFile: { token } },
    // the File taken once with window.parent.__orosTakeFile(token)
    if (t && t.openFile) { if (recFile) recFile.openTarget(t.openFile); return; }
    if (!t || document.querySelector("dialog[open]")) return;
    if (t.addRecipe && typeof t.addRecipe === "object") {
      var rx = C.normRecipe(Object.assign({}, t.addRecipe, { id: "shared-draft", m: 0 }));
      if (!rx) return;
      delete rx.id; delete rx.m; rx.fv = 0;
      setTab("rc");
      openEditor(rx);
      return;
    }
    if (t.pantry === true) { setTab("pa"); return; }
    if (typeof t.recipe === "string") {
      if (!getRecipe(t.recipe)) return;
      setTab("rc");
      openRecipe(t.recipe);
    } else if (typeof t.day === "string" && C.validYmd(t.day)) {
      setTab("wk");
      view.wk = C.weekStartOf(t.day, data.set.ws);
      renderWeek();
      renderShop();
    }
  }
  window.__orosOpenAt = openSearchTarget;
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
