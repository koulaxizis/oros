// ============================================================
// orOS Meal Planner — nutrition.js (pure logic, wave 3)
// Nutrition per serving as an ESTIMATE: calories, protein, carbs and
// fat from each ingredient's amount in grams × its values per 100 g.
//   - A built-in table of common ingredients (values per 100 g, our
//     own rounding of the public-domain USDA FoodData Central "SR
//     Legacy" / "Foundation" foods; for Greek foods with no USDA entry
//     the closest USDA food is used and named in the row's comment).
//     Works offline.
//   - Open Food Facts (https://world.openfoodfacts.org, data under the
//     Open Database License, ODbL): searched per ingredient by name,
//     or a product by barcode. The URLs and the readers of the answers
//     are here; meals.js does the fetching, and only when the user asks.
//   - The user's confirmed match per ingredient key lives in the
//     synced slice (data.nu, see core.js normNu).
// Unit → grams: g/kg/oz/lb exactly; ml, l, fl oz, spoons and cups by
// volume × the food's density (1 g/ml when not known); pieces by the
// food's usual piece weight (or the user's own); a can 400 g, a clove
// 4 g, a pinch 0.4 g, a slice 25 g, a bunch 40 g. A pack has no weight.
// No DOM, no storage, no network. Node tests load it after core.js.
// API: window.OrosMealsNutrition (end of file).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. The built-in table ----------
  // [id, "english names|…", "greek names|…", kcal, protein g, carbs g,
  //  fat g, grams in one piece (0: none), density g/ml (0: 1)]
  // Per 100 g of the food as bought (raw, dry), USDA FoodData Central.
  var ROWS = [
    // Vegetables
    ["tomato", "tomato|tomatoes|cherry tomatoes", "ντομάτα|ντοματίνια", 18, 0.9, 3.9, 0.2, 120, 0],
    ["onion", "onion|onions|red onion|white onion", "κρεμμύδι|ξερό κρεμμύδι|κόκκινο κρεμμύδι", 40, 1.1, 9.3, 0.1, 110, 0],
    ["spring-onion", "spring onion|spring onions|scallion|scallions|green onion", "φρέσκο κρεμμυδάκι|κρεμμυδάκι|κρεμμυδάκια", 32, 1.8, 7.3, 0.2, 15, 0],
    ["garlic", "garlic|garlic clove", "σκόρδο|σκελίδα σκόρδο", 149, 6.4, 33.1, 0.5, 4, 0],
    ["carrot", "carrot|carrots", "καρότο", 41, 0.9, 9.6, 0.2, 60, 0],
    ["celery", "celery|celery stalk|celery stalks", "σέλινο|κλωνάρι σέλινο", 14, 0.7, 3.0, 0.2, 40, 0],
    ["zucchini", "zucchini|courgette|courgettes", "κολοκυθάκι", 17, 1.2, 3.1, 0.3, 200, 0],
    ["eggplant", "eggplant|aubergine", "μελιτζάνα", 25, 1.0, 5.9, 0.2, 300, 0],
    ["lettuce", "lettuce|romaine", "μαρούλι", 15, 1.4, 2.9, 0.2, 360, 0],
    ["cucumber", "cucumber", "αγγούρι", 15, 0.7, 3.6, 0.1, 300, 0],
    ["spinach", "spinach|baby spinach", "σπανάκι", 23, 2.9, 3.6, 0.4, 0, 0],
    ["green-pepper", "green pepper|bell pepper|pepper green", "πράσινη πιπεριά|πιπεριά|πιπεριές", 20, 0.9, 4.6, 0.2, 120, 0],
    ["red-pepper", "red pepper|yellow pepper|red bell pepper", "κόκκινη πιπεριά|κίτρινη πιπεριά|πιπεριά φλωρίνης", 31, 1.0, 6.0, 0.3, 120, 0],
    ["potato", "potato|potatoes", "πατάτα", 77, 2.0, 17.5, 0.1, 170, 0],
    ["sweet-potato", "sweet potato|sweet potatoes", "γλυκοπατάτα", 86, 1.6, 20.1, 0.1, 130, 0],
    ["mushroom", "mushroom|mushrooms", "μανιτάρι", 22, 3.1, 3.3, 0.3, 18, 0],
    ["broccoli", "broccoli", "μπρόκολο", 34, 2.8, 6.6, 0.4, 300, 0],
    ["cauliflower", "cauliflower", "κουνουπίδι", 25, 1.9, 5.0, 0.3, 600, 0],
    ["cabbage", "cabbage", "λάχανο", 25, 1.3, 5.8, 0.1, 900, 0],
    ["leek", "leek|leeks", "πράσο", 61, 1.5, 14.2, 0.3, 90, 0],
    ["ginger", "ginger|fresh ginger", "τζίντζερ|πιπερόριζα", 80, 1.8, 17.8, 0.8, 0, 0],
    ["corn", "corn|sweetcorn|sweet corn", "καλαμπόκι", 86, 3.3, 19.0, 1.4, 0, 0.7],
    ["peas", "peas|green peas", "αρακάς|μπιζέλια", 81, 5.4, 14.5, 0.4, 0, 0.6],
    ["green-beans", "green beans|runner beans", "φασολάκια|φασόλια πράσινα", 31, 1.8, 7.0, 0.2, 0, 0],
    ["pumpkin", "pumpkin|squash", "κολοκύθα", 26, 1.0, 6.5, 0.1, 0, 0],
    ["beetroot", "beetroot|beet|beets", "παντζάρι", 43, 1.6, 9.6, 0.2, 80, 0],
    ["kale", "kale", "κέιλ|λαχανίδα", 35, 2.9, 4.4, 1.5, 0, 0],
    ["rocket", "rocket|arugula", "ρόκα", 25, 2.6, 3.7, 0.7, 0, 0],
    ["artichoke", "artichoke|artichokes", "αγκινάρα", 47, 3.3, 10.5, 0.2, 130, 0],
    ["okra", "okra", "μπάμιες|μπάμια", 33, 1.9, 7.5, 0.2, 0, 0],
    ["asparagus", "asparagus", "σπαράγγια|σπαράγγι", 20, 2.2, 3.9, 0.1, 16, 0],
    ["fennel", "fennel", "μάραθος|μάραθο", 31, 1.2, 7.3, 0.2, 230, 0],
    ["radish", "radish|radishes", "ραπανάκι", 16, 0.7, 3.4, 0.1, 5, 0],
    ["greens", "greens|chard|swiss chard|dandelion greens", "χόρτα|σέσκουλα|βλίτα|ραδίκια", 19, 1.8, 3.7, 0.2, 0, 0],
    ["vine-leaves", "vine leaves|grape leaves", "αμπελόφυλλα", 93, 5.6, 17.3, 2.1, 3, 0],
    ["parsley", "parsley|flat leaf parsley", "μαϊντανός", 36, 3.0, 6.3, 0.8, 0, 0.25],
    ["dill", "dill", "άνηθος|άνιθο", 43, 3.5, 7.0, 1.1, 0, 0.25],
    ["mint", "mint|fresh mint", "δυόσμος|μέντα", 70, 3.8, 14.9, 0.9, 0, 0.25],
    ["basil", "basil|fresh basil", "βασιλικός", 23, 3.2, 2.7, 0.6, 0, 0.25],
    ["coriander", "coriander|cilantro|coriander leaves", "κόλιανδρος", 23, 2.1, 3.7, 0.5, 0, 0.25],
    // Fruit
    ["lemon", "lemon|lemons|lemon juice", "λεμόνι|χυμός λεμονιού", 29, 1.1, 9.3, 0.3, 85, 1.03],
    ["lime", "lime|limes", "λάιμ", 30, 0.7, 10.5, 0.2, 67, 0],
    ["orange", "orange|oranges", "πορτοκάλι", 47, 0.9, 11.8, 0.1, 130, 0],
    ["apple", "apple|apples", "μήλο", 52, 0.3, 13.8, 0.2, 180, 0],
    ["banana", "banana|bananas", "μπανάνα", 89, 1.1, 22.8, 0.3, 118, 0],
    ["strawberry", "strawberry|strawberries", "φράουλα", 32, 0.7, 7.7, 0.3, 12, 0.6],
    ["grapes", "grapes|grape", "σταφύλι|σταφύλια|ρώγες", 69, 0.7, 18.1, 0.2, 0, 0.6],
    ["pear", "pear|pears", "αχλάδι", 57, 0.4, 15.2, 0.1, 178, 0],
    ["peach", "peach|peaches", "ροδάκινο", 39, 0.9, 9.5, 0.3, 150, 0],
    ["cherry", "cherry|cherries", "κεράσι", 63, 1.1, 16.0, 0.2, 8, 0.6],
    ["watermelon", "watermelon", "καρπούζι", 30, 0.6, 7.6, 0.2, 0, 0],
    ["melon", "melon|cantaloupe", "πεπόνι", 34, 0.8, 8.2, 0.2, 0, 0],
    ["kiwi", "kiwi|kiwis|kiwifruit", "ακτινίδιο", 61, 1.1, 14.7, 0.5, 75, 0],
    ["mango", "mango|mangoes", "μάνγκο", 60, 0.8, 15.0, 0.4, 200, 0],
    ["pineapple", "pineapple", "ανανάς", 50, 0.5, 13.1, 0.1, 0, 0],
    ["blueberry", "blueberry|blueberries", "μύρτιλο|μύρτιλα", 57, 0.7, 14.5, 0.3, 0, 0.6],
    ["raspberry", "raspberry|raspberries", "σμέουρο|σμέουρα|βατόμουρα", 52, 1.2, 11.9, 0.7, 0, 0.5],
    ["fig", "fig|figs", "σύκο", 74, 0.8, 19.2, 0.3, 50, 0],
    ["apricot", "apricot|apricots", "βερίκοκο", 48, 1.4, 11.1, 0.4, 35, 0],
    ["plum", "plum|plums", "δαμάσκηνο", 46, 0.7, 11.4, 0.3, 66, 0],
    ["avocado", "avocado|avocados", "αβοκάντο", 160, 2.0, 8.5, 14.7, 150, 0],
    ["raisins", "raisins|sultanas", "σταφίδες|σταφίδα", 299, 3.1, 79.2, 0.5, 0, 0.6],
    ["dates", "dates|medjool dates", "χουρμάδες|χουρμάς", 282, 2.5, 75.0, 0.4, 8, 0],
    // Meat, fish
    ["beef-mince", "minced beef|ground beef|beef mince|mince|minced meat", "κιμάς|κιμάς μοσχαρίσιος|μοσχαρίσιος κιμάς", 254, 17.2, 0, 20.0, 0, 0],
    ["beef", "beef|stewing beef|beef steak|steak|veal", "μοσχάρι|μοσχαρίσιο κρέας|μπριζόλα|μοσχαράκι", 187, 20.0, 0, 12.0, 0, 0],
    ["pork", "pork|pork chops|pork loin|pork shoulder", "χοιρινό|χοιρινή μπριζόλα|χοιρινό κρέας", 196, 19.3, 0, 12.6, 0, 0],
    ["lamb", "lamb|leg of lamb|lamb chops|goat", "αρνί|αρνάκι|κατσίκι|παϊδάκια", 282, 16.6, 0, 23.4, 0, 0],
    ["chicken", "chicken|whole chicken|chicken pieces|chicken legs|chicken thighs", "κοτόπουλο|μπούτια κοτόπουλο|κοτόπουλο μπούτι", 215, 18.6, 0, 15.1, 0, 0],
    ["chicken-breast", "chicken breast|chicken breasts|chicken fillet", "στήθος κοτόπουλο|φιλέτο κοτόπουλο|κοτόπουλο στήθος", 120, 22.5, 0, 2.6, 170, 0],
    ["turkey", "turkey|turkey breast|turkey mince", "γαλοπούλα", 135, 21.0, 0, 5.4, 0, 0],
    ["bacon", "bacon|pancetta", "μπέικον|πανσέτα", 417, 13.0, 1.4, 39.7, 25, 0],
    ["ham", "ham|cooked ham", "ζαμπόν", 145, 21.0, 1.5, 6.0, 20, 0],
    ["sausage", "sausage|sausages", "λουκάνικο", 268, 15.0, 2.0, 22.0, 75, 0],
    ["salami", "salami|chorizo|pepperoni", "σαλάμι|τσορίθο", 407, 22.6, 1.9, 33.7, 0, 0],
    ["salmon", "salmon|salmon fillet", "σολομός", 208, 20.4, 0, 13.4, 150, 0],
    ["tuna", "tuna|canned tuna|tinned tuna", "τόνος|τόνος κονσέρβα", 116, 25.5, 0, 0.8, 0, 0],
    ["cod", "cod|salt cod|white fish|hake", "μπακαλιάρος|μπακαλιαράκι|γλώσσα|πέρκα", 82, 17.8, 0, 0.7, 0, 0],
    ["sea-bream", "sea bream|sea bass|bream|seabream|seabass", "τσιπούρα|λαβράκι", 97, 18.4, 0, 2.0, 400, 0],
    ["sardines", "sardines|sardine|anchovies|anchovy", "σαρδέλα|σαρδέλες|γαύρος|αντζούγια|αντζούγιες", 131, 20.4, 0, 4.8, 0, 0],
    ["mackerel", "mackerel|trout", "σκουμπρί|κολιός|πέστροφα", 205, 18.6, 0, 13.9, 0, 0],
    ["fish", "fish|fish fillet", "ψάρι|ψάρια|φιλέτο ψαριού", 100, 19.0, 0, 2.5, 0, 0],
    ["shrimp", "shrimp|shrimps|prawn|prawns", "γαρίδα|γαρίδες", 85, 20.1, 0, 0.5, 0, 0],
    ["octopus", "octopus", "χταπόδι", 82, 14.9, 2.2, 1.0, 0, 0],
    ["squid", "squid|calamari|cuttlefish", "καλαμάρι|καλαμαράκια|σουπιά|σουπιές", 92, 15.6, 3.1, 1.4, 0, 0],
    ["mussels", "mussels|clams", "μύδια|κυδώνια", 86, 11.9, 3.7, 2.2, 0, 0],
    // Dairy, eggs
    ["egg", "egg|eggs", "αυγό|αυγά", 143, 12.6, 0.7, 9.5, 50, 0],
    ["milk", "milk|whole milk", "γάλα|φρέσκο γάλα", 61, 3.2, 4.8, 3.3, 0, 1.03],
    ["butter", "butter", "βούτυρο", 717, 0.9, 0.1, 81.1, 0, 0.96],
    ["cream", "cream|heavy cream|double cream|whipping cream", "κρέμα γάλακτος|κρέμα", 340, 2.8, 2.7, 36.1, 0, 1.0],
    ["yogurt", "yogurt|yoghurt|plain yogurt", "γιαούρτι", 61, 3.5, 4.7, 3.3, 0, 1.03],
    ["greek-yogurt", "greek yogurt|strained yogurt|greek yoghurt", "στραγγιστό γιαούρτι|γιαούρτι στραγγιστό", 97, 9.0, 4.0, 5.0, 0, 1.05],
    ["feta", "feta|feta cheese", "φέτα|τυρί φέτα", 264, 14.2, 4.1, 21.3, 0, 0.5],
    ["parmesan", "parmesan|grated parmesan|parmigiano", "παρμεζάνα", 392, 35.8, 3.2, 25.8, 0, 0.4],
    // kefalotyri, graviera: USDA "Cheese, romano" / "Cheese, gruyere" (closest)
    ["kefalotyri", "kefalotyri|romano|pecorino", "κεφαλοτύρι|κεφαλογραβιέρα", 387, 31.8, 3.6, 26.9, 0, 0.4],
    ["graviera", "graviera|gruyere|emmental", "γραβιέρα", 413, 29.8, 0.4, 32.3, 0, 0.4],
    ["mozzarella", "mozzarella", "μοτσαρέλα", 300, 22.2, 2.2, 22.4, 125, 0.4],
    ["cheddar", "cheddar|cheese|grated cheese", "τυρί|τριμμένο τυρί|τσένταρ", 403, 24.9, 1.3, 33.1, 0, 0.4],
    // kasseri: USDA "Cheese, provolone" (closest)
    ["kasseri", "kasseri|provolone|gouda|edam", "κασέρι|γκούντα|ένταμ", 351, 25.6, 2.1, 26.6, 0, 0.4],
    // myzithra, anthotyro, manouri: USDA "Cheese, ricotta, whole milk" (closest)
    ["ricotta", "ricotta|cottage cheese|anthotyro|myzithra|manouri", "ρικότα|ανθότυρο|μυζήθρα|μανούρι|cottage", 174, 11.3, 3.0, 13.0, 0, 1.0],
    ["halloumi", "halloumi", "χαλούμι", 321, 21.0, 2.0, 25.0, 0, 0],
    ["cream-cheese", "cream cheese|philadelphia|mascarpone", "τυρί κρέμα|μασκαρπόνε", 350, 6.2, 5.5, 34.4, 0, 1.0],
    ["sour-cream", "sour cream|creme fraiche", "ξινή κρέμα", 198, 2.4, 4.6, 19.4, 0, 1.0],
    ["kefir", "kefir|buttermilk", "κεφίρ|ξινόγαλο", 41, 3.4, 4.5, 1.0, 0, 1.03],
    ["mayonnaise", "mayonnaise|mayo", "μαγιονέζα", 680, 1.0, 0.6, 75.0, 0, 0.91],
    // Grains, bread
    ["flour", "flour|plain flour|all purpose flour|self raising flour|wheat flour", "αλεύρι|αλεύρι για όλες τις χρήσεις|φαρίνα", 364, 10.3, 76.3, 1.0, 0, 0.53],
    ["wholemeal-flour", "wholemeal flour|whole wheat flour", "αλεύρι ολικής|αλεύρι ολικής άλεσης", 340, 13.2, 72.0, 2.5, 0, 0.53],
    ["pasta", "pasta|spaghetti|penne|macaroni|orzo|linguine|fusilli|tagliatelle", "ζυμαρικά|μακαρόνια|σπαγγέτι|κριθαράκι|πένες|χυλοπίτες|μακαρόνια νο 2", 371, 13.0, 74.7, 1.5, 0, 0.45],
    ["egg-noodles", "egg noodles|noodles", "νούντλς", 384, 14.2, 71.3, 4.4, 0, 0.45],
    ["rice", "rice|white rice|long grain rice|basmati|arborio|risotto rice", "ρύζι|ρύζι καρολίνα|ρύζι γλασέ|ρύζι μπασμάτι", 365, 7.1, 80.0, 0.7, 0, 0.8],
    ["brown-rice", "brown rice", "καστανό ρύζι|ρύζι καστανό", 370, 7.9, 77.2, 2.9, 0, 0.8],
    ["bulgur", "bulgur|bulgur wheat|cracked wheat", "πλιγούρι", 342, 12.3, 75.9, 1.3, 0, 0.6],
    ["couscous", "couscous", "κουσκούς", 376, 12.8, 77.4, 0.6, 0, 0.7],
    ["semolina", "semolina", "σιμιγδάλι", 360, 12.7, 72.8, 1.1, 0, 0.7],
    ["oats", "oats|rolled oats|oatmeal|porridge oats", "βρώμη|νιφάδες βρώμης", 379, 13.2, 67.7, 6.5, 0, 0.36],
    ["barley", "barley|pearl barley", "κριθάρι", 352, 9.9, 77.7, 1.2, 0, 0.8],
    ["quinoa", "quinoa", "κινόα", 368, 14.1, 64.2, 6.1, 0, 0.75],
    ["trahanas", "trahanas|tarhana", "τραχανάς", 360, 13.0, 68.0, 3.5, 0, 0.6],
    ["bread", "bread|white bread|loaf|baguette|roll|rolls", "ψωμί|ψωμάκια|μπαγκέτα|φρατζόλα", 265, 9.0, 49.0, 3.2, 30, 0],
    ["wholemeal-bread", "wholemeal bread|whole wheat bread|brown bread", "ψωμί ολικής|ψωμί ολικής άλεσης", 252, 12.5, 42.7, 3.5, 30, 0],
    ["pita", "pita|pitta|pita bread|flatbread", "πίτα|πίτες|αραβική πίτα|πίτα για σουβλάκι", 275, 9.1, 55.7, 1.2, 60, 0],
    ["tortilla", "tortilla|tortillas|wrap|wraps", "τορτίγια|τορτίγιες", 306, 8.2, 50.4, 8.0, 45, 0],
    ["breadcrumbs", "breadcrumbs|bread crumbs|panko", "φρυγανιά τριμμένη|τριμμένη φρυγανιά|γαλέτα", 395, 13.4, 71.9, 5.3, 0, 0.45],
    ["rusk", "rusk|rusks|toast|crispbread|crackers", "φρυγανιές|παξιμάδι|παξιμάδια|κράκερ|κριθαροκουλούρα", 407, 12.0, 74.0, 7.0, 10, 0],
    ["phyllo", "phyllo|filo|filo pastry|phyllo dough", "φύλλο|φύλλο κρούστας|φύλλο για πίτες", 299, 7.1, 52.6, 6.0, 0, 0],
    ["puff-pastry", "puff pastry", "σφολιάτα|φύλλο σφολιάτας", 558, 7.4, 45.7, 38.5, 0, 0],
    ["cornflour", "cornflour|cornstarch|corn starch|starch", "κορν φλάουρ|άμυλο|άμυλο αραβοσίτου", 381, 0.3, 91.3, 0.1, 0, 0.5],
    ["cereal", "cereal|cornflakes|muesli|granola", "δημητριακά|κορν φλέικς|μούσλι|γκρανόλα", 380, 8.0, 78.0, 4.0, 0, 0.3],
    // Pulses, nuts, seeds
    ["beans", "beans|white beans|dried beans|dried white beans|haricot beans|cannellini beans|navy beans|kidney beans|butter beans|giant beans", "φασόλια|ξερά φασόλια|φασόλια μέτρια|γίγαντες|φασόλια γίγαντες|κόκκινα φασόλια", 337, 22.3, 60.8, 1.5, 0, 0.8],
    ["lentils", "lentils|brown lentils|red lentils|green lentils", "φακές|φακές ψιλές|φακές χοντρές", 352, 24.6, 63.4, 1.1, 0, 0.8],
    ["chickpeas", "chickpeas|garbanzo beans", "ρεβίθια", 378, 20.5, 62.9, 6.0, 0, 0.8],
    ["split-peas", "split peas|yellow split peas|fava", "φάβα|φάβα σαντορίνης", 341, 24.6, 60.4, 1.2, 0, 0.8],
    ["tofu", "tofu", "τόφου", 144, 17.3, 2.8, 8.7, 0, 0],
    ["almonds", "almonds|almond|ground almonds|flaked almonds", "αμύγδαλα|αμύγδαλο|αμυγδαλόψιχα", 579, 21.2, 21.6, 49.9, 1.2, 0.5],
    ["walnuts", "walnuts|walnut", "καρύδια|καρύδι|καρυδόψιχα", 654, 15.2, 13.7, 65.2, 4, 0.45],
    ["hazelnuts", "hazelnuts|hazelnut", "φουντούκια|φουντούκι", 628, 15.0, 16.7, 60.8, 1.5, 0.5],
    ["pistachios", "pistachios|pistachio", "φιστίκια αιγίνης|φιστίκι αιγίνης", 560, 20.2, 27.2, 45.3, 0.7, 0.5],
    ["cashews", "cashews|cashew", "κάσιους", 553, 18.2, 30.2, 43.9, 1.5, 0.5],
    ["peanuts", "peanuts|peanut", "φιστίκια|αράπικα φιστίκια", 567, 25.8, 16.1, 49.2, 0.5, 0.55],
    ["pine-nuts", "pine nuts", "κουκουνάρι|κουκουνάρια", 673, 13.7, 13.1, 68.4, 0, 0.55],
    ["sesame", "sesame|sesame seeds", "σουσάμι", 573, 17.7, 23.4, 49.7, 0, 0.6],
    ["seeds", "sunflower seeds|pumpkin seeds|seeds", "ηλιόσποροι|πασατέμπος|κολοκυθόσποροι", 584, 20.8, 20.0, 51.5, 0, 0.55],
    ["tahini", "tahini|tahina", "ταχίνι", 595, 17.0, 21.2, 53.8, 0, 1.08],
    ["peanut-butter", "peanut butter", "φυστικοβούτυρο", 588, 25.1, 20.0, 50.4, 0, 1.08],
    // Cupboard
    ["olive-oil", "olive oil|extra virgin olive oil", "ελαιόλαδο|παρθένο ελαιόλαδο|λάδι ελιάς", 884, 0, 0, 100.0, 0, 0.92],
    ["oil", "oil|vegetable oil|sunflower oil|corn oil|canola oil", "λάδι|ηλιέλαιο|σπορέλαιο|καλαμποκέλαιο", 884, 0, 0, 100.0, 0, 0.92],
    ["sugar", "sugar|caster sugar|white sugar|granulated sugar|brown sugar", "ζάχαρη|καστανή ζάχαρη|ζάχαρη άχνη", 387, 0, 100.0, 0, 0, 0.85],
    ["honey", "honey", "μέλι", 304, 0.3, 82.4, 0, 0, 1.42],
    ["syrup", "syrup|maple syrup|golden syrup|agave syrup", "σιρόπι|σιρόπι σφενδάμου", 260, 0, 67.0, 0.1, 0, 1.33],
    ["jam", "jam|marmalade|preserves", "μαρμελάδα|γλυκό του κουταλιού", 278, 0.4, 68.9, 0.1, 0, 1.3],
    ["chocolate", "chocolate|dark chocolate|chocolate chips", "σοκολάτα|κουβερτούρα|σοκολάτα υγείας", 546, 4.9, 61.2, 31.3, 0, 0.6],
    ["cocoa", "cocoa|cocoa powder", "κακάο", 228, 19.6, 57.9, 13.7, 0, 0.36],
    ["tomato-paste", "tomato paste|tomato puree|tomato concentrate", "πελτές|πελτές ντομάτας|τοματοπολτός", 82, 4.3, 18.9, 0.5, 0, 1.1],
    ["canned-tomatoes", "chopped tomatoes|canned tomatoes|tinned tomatoes|crushed tomatoes|passata|tomato sauce", "ντομάτα κονκασέ|ντομάτες κονκασέ|ντομάτα κονσέρβα|ντομάτα τριμμένη|τριμμένη ντομάτα|πασάτα|σάλτσα ντομάτας|ντοματάκια κονσέρβα", 32, 1.6, 7.3, 0.3, 0, 1.03],
    ["olives", "olives|black olives|green olives|kalamata olives", "ελιές|ελιές καλαμών|πράσινες ελιές|μαύρες ελιές", 145, 1.0, 3.8, 15.3, 4, 0.6],
    ["capers", "capers", "κάπαρη", 23, 2.4, 4.9, 0.9, 0, 0.6],
    ["vinegar", "vinegar|wine vinegar|balsamic vinegar|apple cider vinegar", "ξίδι|ξύδι|βαλσάμικο", 18, 0, 0.04, 0, 0, 1.01],
    ["stock", "stock|broth|chicken stock|vegetable stock|beef stock", "ζωμός|ζωμός κότας|ζωμός λαχανικών", 7, 0.6, 0.4, 0.2, 0, 1.0],
    ["stock-cube", "stock cube|bouillon cube|bouillon", "κύβος|κύβος ζωμού|ζωμός σε κύβο", 267, 16.7, 18.0, 13.9, 10, 0],
    ["mustard", "mustard|dijon mustard", "μουστάρδα", 60, 3.7, 5.8, 3.3, 0, 1.05],
    ["ketchup", "ketchup|tomato ketchup", "κέτσαπ", 101, 1.0, 27.4, 0.1, 0, 1.15],
    ["soy-sauce", "soy sauce", "σάλτσα σόγιας|σόγια", 53, 8.1, 4.9, 0.6, 0, 1.15],
    ["coconut-milk", "coconut milk", "γάλα καρύδας", 197, 2.0, 2.8, 21.3, 0, 1.0],
    ["yeast", "yeast|dry yeast|instant yeast", "μαγιά|ξερή μαγιά|μαγιά ξηρή", 325, 40.4, 41.2, 7.6, 8, 0.6],
    ["baking-powder", "baking powder|baking soda|bicarbonate of soda", "μπέικιν πάουντερ|σόδα|σόδα φαγητού|αμμωνία", 53, 0, 27.7, 0, 0, 0.9],
    ["gelatine", "gelatine|gelatin", "ζελατίνη", 335, 85.6, 0, 0.1, 2, 0.6],
    // Spices and herbs (dried)
    ["salt", "salt|sea salt", "αλάτι|θαλασσινό αλάτι", 0, 0, 0, 0, 0, 1.2],
    ["black-pepper", "pepper|black pepper|ground pepper", "πιπέρι|μαύρο πιπέρι", 251, 10.4, 64.0, 3.3, 0, 0.5],
    ["oregano", "oregano|dried oregano", "ρίγανη", 265, 9.0, 68.9, 4.3, 0, 0.3],
    ["thyme", "thyme|dried thyme|rosemary|sage", "θυμάρι|δεντρολίβανο|φασκόμηλο", 276, 9.1, 63.9, 7.4, 0, 0.3],
    ["cumin", "cumin|ground cumin", "κύμινο", 375, 17.8, 44.2, 22.3, 0, 0.45],
    ["paprika", "paprika|smoked paprika|chili powder|chilli flakes|chili flakes|cayenne", "πάπρικα|μπούκοβο|καυτερή πάπρικα|τσίλι", 282, 14.1, 54.0, 12.9, 0, 0.45],
    ["cinnamon", "cinnamon|ground cinnamon|cinnamon stick", "κανέλα|ξυλάκι κανέλα|κανέλα ξύλο", 247, 4.0, 80.6, 1.2, 3, 0.5],
    ["spice", "nutmeg|cloves|allspice|curry powder|curry|turmeric|ground ginger|bay leaf|bay leaves|vanilla", "μοσχοκάρυδο|γαρίφαλο|μπαχάρι|κάρι|κουρκουμάς|φύλλο δάφνης|φύλλα δάφνης|δάφνη|βανίλια", 320, 10.0, 60.0, 9.0, 0.3, 0.5],
    // Drinks
    ["water", "water", "νερό", 0, 0, 0, 0, 0, 1.0],
    ["wine", "wine|red wine|white wine", "κρασί|κόκκινο κρασί|λευκό κρασί", 84, 0.1, 2.6, 0, 0, 0.99],
    ["beer", "beer", "μπύρα", 43, 0.5, 3.6, 0, 0, 1.0],
    ["juice", "orange juice|juice|apple juice", "χυμός|χυμός πορτοκάλι|χυμός πορτοκαλιού", 45, 0.7, 10.4, 0.2, 0, 1.04],
    ["coffee", "coffee|tea", "καφές|τσάι", 1, 0.1, 0, 0, 0, 1.0]
  ];

  // ---------- 2. Matching a name to a row ----------
  function core() { return root.OrosMealsCore; }
  var TABLE = null, BY_ID = {}, PHRASES = [];
  function build() {
    if (TABLE) return;
    var C = core();
    TABLE = ROWS.map(function (r) {
      var row = { id: r[0], en: r[1].split("|")[0], el: r[2].split("|")[0], k: r[3], p: r[4], cb: r[5], f: r[6], pc: r[7] || 0, d: r[8] || 1 };
      BY_ID[row.id] = row;
      (r[1] + "|" + r[2]).split("|").forEach(function (name) {
        var k = C.keyOf(name);
        if (k) PHRASES.push({ k: k, n: k.split(" ").length, row: row });
      });
      return row;
    });
    // Longest phrase first ("tomato paste" before "tomato"); same
    // length: the first row in the table wins (a stable order).
    PHRASES.forEach(function (p, i) { p.i = i; });
    PHRASES.sort(function (x, y) { return y.n - x.n || y.k.length - x.k.length || x.i - y.i; });
  }
  // Words that change the food a little but not its row ("chopped",
  // "fresh", "ψιλοκομμένο") are not needed: the match looks for a
  // table phrase anywhere in the ingredient key, as whole words.
  function findBuiltIn(name) {
    build();
    var k = core().keyOf(name);
    if (!k) return null;
    var padded = " " + k + " ";
    for (var i = 0; i < PHRASES.length; i++) {
      if (padded.indexOf(" " + PHRASES[i].k + " ") >= 0) return PHRASES[i].row;
    }
    return null;
  }
  function rowById(id) { build(); return BY_ID[id] || null; }
  function rows() { build(); return TABLE.slice(); }

  // ---------- 3. Unit → grams ----------
  var FIXED_G = { can: 400, clove: 4, pinch: 0.4, slice: 25, bunch: 40 };
  // Grams of q units u of a food (row: { pc, d } or null). null when it
  // cannot be told (a pack, a piece of something with no piece weight).
  // pieceG: the user's own grams in one piece (overrides the row's).
  function grams(q, u, row, pieceG) {
    var C = core(), U = C.UNITS[u];
    if (q === null || q === undefined || !isFinite(q) || q <= 0) return null;
    var d = row && row.d ? row.d : 1;
    if (U && U.fam === "mass") return q * U.f;
    if (U && U.fam === "vol") return q * U.f * d;
    if (U && U.fam === "spoon") return q * U.f * 5 * d;           // tsp 5 ml, tbsp 15 ml, cup 240 ml
    if (!u || u === "pc") {
      var pg = pieceG || (row && row.pc) || 0;
      return pg ? q * pg : null;
    }
    if (u === "slice" && pieceG) return q * pieceG;
    if (FIXED_G[u]) return q * FIXED_G[u];
    if (u === "pack" && pieceG) return q * pieceG;
    return null;
  }

  // ---------- 4. The estimate ----------
  // The values per 100 g for one ingredient: the user's choice
  // (nu[key]), else the built-in row the name finds.
  // → { src: "tbl"|"off"|"x"|"", row, v: {k,p,cb,f} | null, g: piece g, name }
  function valuesFor(name, nu) {
    var C = core(), k = C.keyOf(name), m = nu && nu[k];
    if (m && m.s === "x") return { src: "x", v: null, row: null, g: 0, name: "" };
    // An Open Food Facts match brings the values; the table's row (if
    // the name finds one) still gives the density and the piece weight.
    if (m && m.s === "off") return { src: "off", v: { k: m.k, p: m.p, cb: m.cb, f: m.f }, row: findBuiltIn(name), g: m.g || 0, name: m.nm || "", code: m.c || "" };
    var row = m && m.s === "tbl" ? rowById(m.t) : null;
    var auto = !row;
    if (!row) row = findBuiltIn(name);
    if (!row) return { src: "", v: null, row: null, g: m && m.g || 0, name: "" };
    return { src: "tbl", auto: auto, v: { k: row.k, p: row.p, cb: row.cb, f: row.f }, row: row, g: m && m.g || 0, name: row.id };
  }
  function zero() { return { k: 0, p: 0, cb: 0, f: 0 }; }
  function addTo(sum, v, g) { sum.k += v.k * g / 100; sum.p += v.p * g / 100; sum.cb += v.cb * g / 100; sum.f += v.f * g / 100; }
  // A recipe (or a draft) → per serving and in total. factor: servings
  // shown / recipe servings (the per-serving numbers do not change).
  // Each row: { ing, key, st: "ok"|"nomatch"|"noqty"|"nogram"|"x", g, src, name }
  //   "noqty": no amount written ("salt"): counted as nothing.
  function recipeNutrition(rec, nu) {
    var C = core();
    var total = zero(), rowsOut = [], counted = 0, missing = 0;
    (rec.ig || []).forEach(function (ing) {
      var key = C.keyOf(ing.n), vf = valuesFor(ing.n, nu);
      var r = { ing: ing, key: key, st: "", g: null, src: vf.src, name: vf.name, auto: !!vf.auto, code: vf.code || "" };
      if (vf.src === "x") r.st = "x";
      else if (ing.q === null) r.st = vf.v ? "noqty" : "nomatch";
      else if (!vf.v) { r.st = "nomatch"; missing++; }
      else {
        var g = grams(ing.q, ing.u, vf.row, vf.g);
        if (g === null) { r.st = "nogram"; missing++; }
        else { r.st = "ok"; r.g = g; addTo(total, vf.v, g); counted++; }
      }
      rowsOut.push(r);
    });
    var sv = rec.sv > 0 ? rec.sv : 1;
    var per = { k: total.k / sv, p: total.p / sv, cb: total.cb / sv, f: total.f / sv };
    return { total: total, per: per, rows: rowsOut, counted: counted, missing: missing, any: counted > 0 };
  }
  // A day of the plan for one person: one serving of each planned
  // recipe. cells: [{ it: [{ r, sv }…] }…]; getRecipe(id) → recipe.
  // → { sum: {k,p,cb,f}, n: recipes counted, partial: some had gaps }
  function dayNutrition(cells, getRecipe, nu, cache) {
    var sum = zero(), n = 0, partial = false;
    (cells || []).forEach(function (cell) {
      (cell && cell.it || []).forEach(function (it) {
        if (!it.r) return;
        var rec = getRecipe(it.r);
        if (!rec) return;
        var key = rec.id + "@" + rec.m;
        var e = cache && cache[key];
        if (!e) { e = recipeNutrition(rec, nu); if (cache) cache[key] = e; }
        if (!e.any) { partial = true; return; }
        sum.k += e.per.k; sum.p += e.per.p; sum.cb += e.per.cb; sum.f += e.per.f;
        if (e.missing) partial = true;
        n++;
      });
    });
    return { sum: sum, n: n, partial: partial };
  }

  // ---------- 5. Open Food Facts ----------
  var OFF = "https://world.openfoodfacts.org";
  var FIELDS = "code,product_name,product_name_en,product_name_el,generic_name,brands,quantity,nutriments";
  function offSearchUrl(q, lang) {
    return OFF + "/cgi/search.pl?search_terms=" + encodeURIComponent(String(q || "").slice(0, 80)) +
      "&search_simple=1&action=process&json=1&page_size=12&lc=" + (lang === "el" ? "el" : "en") + "&fields=" + FIELDS;
  }
  function offProductUrl(code) {
    return OFF + "/api/v2/product/" + encodeURIComponent(code) + ".json?lc=" + "en" + "&fields=" + FIELDS;
  }
  function offPageUrl(code) { return OFF + "/product/" + encodeURIComponent(code); }
  function nf(v) {
    var n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
    return typeof n === "number" && isFinite(n) && n >= 0 ? n : null;
  }
  function txt(s, max) { return core().clean(typeof s === "string" ? s : "", max || 80); }
  // One product of an answer → { code, name, brand, qty: "400 g", v: {k,p,cb,f} | null } or null.
  function offProduct(p, lang) {
    if (!p || typeof p !== "object") return null;
    var code = typeof p.code === "string" && /^\d{6,14}$/.test(p.code) ? p.code : "";
    var name = txt(lang === "el" && p.product_name_el) || txt(p.product_name) || txt(p.product_name_en) || txt(p.generic_name);
    if (!name) return null;
    var n = p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {};
    var k = nf(n["energy-kcal_100g"]);
    if (k === null && nf(n.energy_100g) !== null && n.energy_unit !== "kcal") k = nf(n.energy_100g) / 4.184;   // kJ
    if (k === null && nf(n["energy-kj_100g"]) !== null) k = nf(n["energy-kj_100g"]) / 4.184;
    var p1 = nf(n.proteins_100g), c1 = nf(n.carbohydrates_100g), f1 = nf(n.fat_100g);
    var v = (k !== null && k <= 1000 && p1 !== null && c1 !== null && f1 !== null && p1 <= 100 && c1 <= 100 && f1 <= 100)
      ? { k: Math.round(k * 10) / 10, p: Math.round(p1 * 10) / 10, cb: Math.round(c1 * 10) / 10, f: Math.round(f1 * 10) / 10 } : null;
    return { code: code, name: name, brand: txt(p.brands, 60).split(",")[0].trim(), qty: txt(p.quantity, 40), v: v };
  }
  function parseOffSearch(json, lang) {
    var out = [];
    var list = json && Array.isArray(json.products) ? json.products : [];
    list.forEach(function (p) { var x = offProduct(p, lang); if (x && x.v && out.length < 12) out.push(x); });
    return out;
  }
  function parseOffProduct(json, lang) {
    if (!json || typeof json !== "object" || json.status === 0 || json.status === "failure" || !json.product) return null;
    return offProduct(json.product, lang);
  }
  // "400 g", "1,5 l", "6 x 125 g", "500ml" → { q, u } in the app's units.
  function parseQuantity(s) {
    var C = core();
    s = txt(s, 40).toLowerCase().replace(/(\d)\s*(?=[a-zµμλκγ])/g, "$1 ");
    var mult = s.match(/^(\d+)\s*[x×]\s*(.+)$/);
    var k = 1;
    if (mult) { k = Number(mult[1]); s = mult[2]; }
    var m = s.match(/^(\d+(?:[.,]\d+)?)\s*([a-zα-ω.]+)?/);
    if (!m) return null;
    var q = Number(m[1].replace(",", ".")) * k;
    if (!(q > 0)) return null;
    var u = (m[2] || "").replace(/\.$/, "");
    var map = { g: "g", gr: "g", grams: "g", "γρ": "g", kg: "kg", "κιλό": "kg", ml: "ml", cl: "cl", dl: "dl", l: "l", lt: "l", "λίτρο": "l", oz: "oz", lb: "lb" };
    var id = map[u];
    if (id === "cl") { q *= 10; id = "ml"; }
    if (id === "dl") { q *= 100; id = "ml"; }
    if (!id) return u ? null : { q: q, u: "pc" };
    if (!C.UNITS[id]) return null;
    return { q: Math.round(q * 1000) / 1000, u: id };
  }
  // A GTIN / EAN / UPC check digit (8, 12, 13 or 14 digits).
  function validBarcode(code) {
    if (typeof code !== "string" || !/^(\d{8}|\d{12,14})$/.test(code)) return false;
    var sum = 0, n = code.length;
    for (var i = 0; i < n - 1; i++) sum += Number(code.charAt(i)) * ((n - 1 - i) % 2 === 1 ? 3 : 1);
    return (10 - sum % 10) % 10 === Number(code.charAt(n - 1));
  }

  root.OrosMealsNutrition = {
    ROWS_COUNT: ROWS.length, OFF: OFF,
    findBuiltIn: findBuiltIn, rowById: rowById, rows: rows, grams: grams, valuesFor: valuesFor,
    recipeNutrition: recipeNutrition, dayNutrition: dayNutrition,
    offSearchUrl: offSearchUrl, offProductUrl: offProductUrl, offPageUrl: offPageUrl,
    parseOffSearch: parseOffSearch, parseOffProduct: parseOffProduct, parseQuantity: parseQuantity,
    validBarcode: validBarcode
  };
})(typeof window !== "undefined" ? window : this);
