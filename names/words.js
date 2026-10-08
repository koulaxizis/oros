// ============================================================
// orOS Name Generator — word lists (v1.0.0)
// Written for orOS; nothing taken from other generators.
// Data only: names.js builds every name from these lists.
//   handle: adjective + noun, Latin letters only
//     en: English words; el: Greek neuter words, transliterated
//   title: [adj] role [thing]
//     el roles and adjectives carry [masculine, feminine]
//   regal: syllable-built fantasy name + epithet
//     el endings carry the accent, so every name has exactly one
// ============================================================
(function (root) {
  "use strict";

  var W = {
    handle: {
      en: {
        adj: [
          "quiet", "neon", "lucky", "sleepy", "brave", "silver", "golden", "tiny", "cosmic", "velvet",
          "rusty", "misty", "sunny", "stormy", "frosty", "lazy", "swift", "gentle", "wild", "humble",
          "clever", "curious", "hidden", "lost", "electric", "paper", "pixel", "lunar", "solar", "amber",
          "crimson", "indigo", "violet", "mossy", "salty", "sweet", "spicy", "fuzzy", "shiny", "dusty",
          "midnight", "morning", "rainy", "windy", "woolly", "jolly", "plucky", "nimble", "mellow", "witty",
          "tidy", "odd", "secret", "humming", "wandering", "drifting", "glowing", "dreamy", "patient", "bold",
          "copper", "cobalt", "coral", "minty", "honey", "maple", "polar", "northern", "little", "mighty",
          "bouncy", "breezy", "cozy", "crisp", "dapper", "fancy", "lofty", "rapid", "snowy", "zesty"
        ],
        noun: [
          "comet", "otter", "pilot", "moss", "fox", "owl", "lantern", "pebble", "maple", "harbor",
          "falcon", "badger", "willow", "meadow", "river", "cloud", "thunder", "ember", "cactus", "teapot",
          "pancake", "noodle", "biscuit", "pickle", "mango", "lemon", "walnut", "acorn", "pine", "fern",
          "raven", "sparrow", "heron", "panda", "koala", "lynx", "moth", "beetle", "squid", "whale",
          "dolphin", "turtle", "gecko", "hedgehog", "rabbit", "kitten", "puppy", "goose", "parrot", "penguin",
          "rocket", "robot", "wizard", "knight", "pirate", "ranger", "nomad", "scribe", "bard", "sailor",
          "atlas", "compass", "anchor", "beacon", "orbit", "nebula", "quasar", "galaxy", "planet", "meteor",
          "violin", "piano", "drum", "banjo", "kazoo", "cassette", "vinyl", "radio", "pixel", "byte",
          "sketch", "doodle", "riddle", "puzzle", "marble", "button", "ribbon", "candle", "kettle", "mitten",
          "island", "canyon", "glacier", "volcano", "lagoon", "orchard", "garden", "attic", "tower", "bridge"
        ]
      },
      el: {
        adj: [
          "μικρό", "γαλάζιο", "ήσυχο", "χρυσό", "ασημένιο", "κόκκινο", "πράσινο", "μαύρο", "άσπρο", "σιωπηλό",
          "γρήγορο", "αργό", "τρελό", "νυσταγμένο", "ζεστό", "κρύο", "μακρινό", "κρυφό", "παλιό", "νέο",
          "λαμπερό", "θολό", "αλμυρό", "γλυκό", "άγριο", "ήμερο", "ψηλό", "φωτεινό", "σκοτεινό", "βαθύ",
          "ελαφρύ", "μαγικό", "χαμένο", "τυχερό", "φευγάτο", "αφηρημένο", "ονειρεμένο", "ατίθασο", "ξύπνιο", "γενναίο",
          "σοφό", "περίεργο", "χαρούμενο", "βελούδινο", "μεταξένιο", "πέτρινο", "ξύλινο", "γυάλινο", "φεγγαρένιο", "θαλασσινό",
          "καλό", "ζωηρό", "μοναχικό", "πεισματάρικο", "αστείο", "όμορφο", "κεφάτο", "ήπιο", "πρωινό", "βραδινό"
        ],
        noun: [
          "φεγγάρι", "αστέρι", "σύννεφο", "κύμα", "βουνό", "δάσος", "ποτάμι", "λιβάδι", "φύλλο", "λουλούδι",
          "κλαδί", "βότσαλο", "κοχύλι", "νησί", "φανάρι", "καράβι", "ποδήλατο", "τρένο", "μολύβι", "βιβλίο",
          "τετράδιο", "κλειδί", "παράθυρο", "ρολόι", "φτερό", "πουλί", "σπουργίτι", "χελιδόνι", "ελάφι", "λιοντάρι",
          "γατάκι", "σκυλάκι", "κουνελάκι", "ψάρι", "δελφίνι", "χταπόδι", "μυρμήγκι", "τζιτζίκι", "μελισσάκι", "κεράσι",
          "ρόδι", "μήλο", "πορτοκάλι", "λεμόνι", "σύκο", "καρπούζι", "μέλι", "τσάι", "κερί", "όνειρο",
          "τραγούδι", "ποίημα", "χιόνι", "αεράκι", "αστεράκι", "κάστρο", "γεφύρι", "μονοπάτι", "σοκάκι", "μπαλκόνι",
          "ραδιόφωνο", "πιάνο", "βιολί", "τύμπανο", "μπισκότο", "κουλούρι", "λουκούμι", "φιστίκι", "καρύδι", "αμύγδαλο"
        ]
      }
    },

    title: {
      en: {
        adj: [
          "Professional", "Amateur", "Part-Time", "Self-Taught", "Retired", "Reluctant", "Accidental", "Certified",
          "Aspiring", "Honorary", "Freelance", "Chief", "Senior", "Junior", "Wandering", "Sleepy",
          "Gentle", "Curious", "Unofficial", "Lifelong", "Weekend", "Midnight", "Cosmic", "Pocket-Sized",
          "Award-Winning", "Self-Appointed", "Undercover", "Semi-Retired", "Hopeless", "Tireless", "Romantic", "Quiet",
          "Brave", "Absent-Minded", "Overqualified", "Enthusiastic", "Modest", "Legendary", "Local", "Travelling"
        ],
        role: [
          "Collector", "Keeper", "Curator", "Captain", "Archivist", "Cartographer", "Wanderer", "Daydreamer",
          "Gardener", "Professor", "Apprentice", "Guardian", "Architect", "Ambassador", "Chronicler", "Composer",
          "Detective", "Explorer", "Librarian", "Navigator", "Philosopher", "Pilot", "Poet", "Scholar",
          "Shepherd", "Translator", "Tinkerer", "Wizard", "Alchemist", "Connoisseur", "Champion", "Inventor",
          "Storyteller", "Stargazer", "Night Owl", "Mapmaker", "Beekeeper", "Lighthouse Keeper", "Tea Brewer", "Bookworm",
          "Cloud Watcher", "Puzzle Solver", "Mixtape Maker", "Pancake Flipper", "Plant Whisperer", "Sock Finder"
        ],
        thing: [
          "of Rainy Afternoons", "of Lost Keys", "of Unfinished Projects", "of Quiet Mornings", "of Old Maps",
          "of Distant Stars", "of Second Chances", "of Forgotten Songs", "of Small Wonders", "of Warm Tea",
          "of Stray Ideas", "of Hidden Paths", "of Open Tabs", "of Half-Read Books", "of Midnight Snacks",
          "of Paper Boats", "of Sunday Naps", "of Loose Threads", "of Tiny Victories", "of Odd Socks",
          "of Good Excuses", "of Long Walks", "of Bad Puns", "of Lost Umbrellas", "of Pocket Notebooks",
          "of Late Trains", "of Bright Ideas", "of Slow Sundays", "of Rare Vinyl", "of Kind Words",
          "of Strange Dreams", "of Empty Pages", "of Morning Coffee", "of Window Seats", "of Wild Guesses",
          "of the Last Slice", "of the Snooze Button", "of the Group Chat", "of the Back Row", "of the Night Shift",
          "of the Secret Recipe", "of the Spare Charger", "of the Old Radio", "of the Long Weekend", "of the Missing Piece",
          "of Houseplants", "of Thunderstorms", "of Postcards", "of Sea Glass", "of Shooting Stars",
          "of Borrowed Pens", "of Lucky Pennies", "of Snow Days", "of Street Cats", "of Golden Hours",
          "of Unread Emails", "of Spilled Ink", "of Clever Shortcuts", "of Quiet Corners", "of Paper Planes"
        ]
      },
      el: {
        adj: [
          ["Αυτοδίδακτος", "Αυτοδίδακτη"], ["Συνταξιούχος", "Συνταξιούχος"], ["Απρόθυμος", "Απρόθυμη"],
          ["Τυχαίος", "Τυχαία"], ["Πιστοποιημένος", "Πιστοποιημένη"], ["Επίτιμος", "Επίτιμη"],
          ["Ανεξάρτητος", "Ανεξάρτητη"], ["Νυσταγμένος", "Νυσταγμένη"], ["Ευγενικός", "Ευγενική"],
          ["Περίεργος", "Περίεργη"], ["Ανεπίσημος", "Ανεπίσημη"], ["Κοσμικός", "Κοσμική"],
          ["Βραβευμένος", "Βραβευμένη"], ["Αυτόκλητος", "Αυτόκλητη"], ["Μεταμεσονύχτιος", "Μεταμεσονύχτια"],
          ["Περιπλανώμενος", "Περιπλανώμενη"], ["Φιλόδοξος", "Φιλόδοξη"], ["Μυστικός", "Μυστική"],
          ["Επίμονος", "Επίμονη"], ["Ήσυχος", "Ήσυχη"], ["Αθεράπευτος", "Αθεράπευτη"],
          ["Ακούραστος", "Ακούραστη"], ["Ρομαντικός", "Ρομαντική"], ["Χαμογελαστός", "Χαμογελαστή"],
          ["Γενναίος", "Γενναία"], ["Αφηρημένος", "Αφηρημένη"], ["Θρυλικός", "Θρυλική"],
          ["Ενθουσιώδης", "Ενθουσιώδης"], ["Σεμνός", "Σεμνή"], ["Τοπικός", "Τοπική"],
          ["Ταξιδιάρης", "Ταξιδιάρα"], ["Υπερπροσοντούχος", "Υπερπροσοντούχα"], ["Ερασιτέχνης", "Ερασιτέχνις"],
          ["Μικροσκοπικός", "Μικροσκοπική"], ["Ανυπόμονος", "Ανυπόμονη"], ["Αισιόδοξος", "Αισιόδοξη"]
        ],
        role: [
          ["συλλέκτης", "συλλέκτρια"], ["φύλακας", "φύλακας"], ["επιμελητής", "επιμελήτρια"],
          ["καπετάνιος", "καπετάνισσα"], ["αρχειοθέτης", "αρχειοθέτρια"], ["χαρτογράφος", "χαρτογράφος"],
          ["περιπλανητής", "περιπλανήτρια"], ["ονειροπόλος", "ονειροπόλα"], ["κηπουρός", "κηπουρός"],
          ["καθηγητής", "καθηγήτρια"], ["μαθητευόμενος", "μαθητευόμενη"], ["θεματοφύλακας", "θεματοφύλακας"],
          ["αρχιτέκτονας", "αρχιτέκτονας"], ["πρέσβης", "πρέσβειρα"], ["χρονικογράφος", "χρονικογράφος"],
          ["συνθέτης", "συνθέτρια"], ["ντετέκτιβ", "ντετέκτιβ"], ["εξερευνητής", "εξερευνήτρια"],
          ["βιβλιοθηκάριος", "βιβλιοθηκάρια"], ["πλοηγός", "πλοηγός"], ["φιλόσοφος", "φιλόσοφος"],
          ["πιλότος", "πιλότος"], ["ποιητής", "ποιήτρια"], ["μελετητής", "μελετήτρια"],
          ["βοσκός", "βοσκοπούλα"], ["μεταφραστής", "μεταφράστρια"], ["μάστορας", "μαστόρισσα"],
          ["μάγος", "μάγισσα"], ["αλχημιστής", "αλχημίστρια"], ["γνώστης", "γνώστρια"],
          ["πρωταθλητής", "πρωταθλήτρια"], ["εφευρέτης", "εφευρέτρια"], ["παραμυθάς", "παραμυθού"],
          ["αστροπαρατηρητής", "αστροπαρατηρήτρια"], ["νυχτοπούλι", "νυχτοπούλι"], ["μελισσοκόμος", "μελισσοκόμος"],
          ["φαροφύλακας", "φαροφύλακας"], ["βιβλιοφάγος", "βιβλιοφάγος"], ["λύτης γρίφων", "λύτρια γρίφων"],
          ["ταξιδιώτης", "ταξιδιώτισσα"], ["θαυμαστής", "θαυμάστρια"], ["αφηγητής", "αφηγήτρια"]
        ],
        thing: [
          "βροχερών απογευμάτων", "χαμένων κλειδιών", "μισοτελειωμένων σχεδίων", "ήσυχων πρωινών", "παλιών χαρτών",
          "μακρινών αστεριών", "δεύτερων ευκαιριών", "ξεχασμένων τραγουδιών", "μικρών θαυμάτων", "ζεστού τσαγιού",
          "αδέσποτων ιδεών", "κρυφών μονοπατιών", "ανοιχτών καρτελών", "μισοδιαβασμένων βιβλίων", "μεταμεσονύχτιων σνακ",
          "χάρτινων καραβιών", "κυριακάτικων υπνάκων", "χαμένων κάλτσων", "μικρών νικών", "καλών δικαιολογιών",
          "μεγάλων περιπάτων", "κακών λογοπαιγνίων", "ξεχασμένων ομπρελών", "καθυστερημένων τρένων", "φωτεινών ιδεών",
          "αργών Κυριακών", "σπάνιων δίσκων", "καλών λόγων", "παράξενων ονείρων", "λευκών σελίδων",
          "πρωινού καφέ", "παραθύρων στο λεωφορείο", "τρελών υποθέσεων", "του τελευταίου κομματιού", "του κουμπιού αναβολής",
          "της ομαδικής συνομιλίας", "του πίσω θρανίου", "της νυχτερινής βάρδιας", "της μυστικής συνταγής", "του εφεδρικού φορτιστή",
          "του παλιού ραδιοφώνου", "του τριημέρου", "του κομματιού που λείπει", "των φυτών εσωτερικού χώρου", "των καταιγίδων",
          "των καρτ ποστάλ", "των θαλασσινών βότσαλων", "των πεφταστεριών", "δανεικών στυλό", "τυχερών κερμάτων",
          "χιονισμένων ημερών", "αδέσποτων γατών", "χρυσών δειλινών", "αδιάβαστων μηνυμάτων", "χυμένου μελανιού",
          "έξυπνων συντομεύσεων", "ήσυχων γωνιών", "χάρτινων αεροπλάνων", "ζεστών κουβερτών", "παλιών φωτογραφιών"
        ]
      }
    },

    regal: {
      en: {
        start: [
          "Al", "Bri", "Cael", "Dor", "El", "Fen", "Gar", "Hal", "Is", "Jor", "Kel", "Lys", "Mor", "Ny",
          "Or", "Per", "Quil", "Ros", "Syl", "Tor", "Ul", "Vel", "Wyn", "Yr", "Zor", "Ar", "Bel", "Cor",
          "Dra", "Ev", "Gwen", "Ith", "Lor", "Mael", "Ner", "Os", "Ran", "Ser", "Tam", "Ver"
        ],
        mid: ["", "", "", "a", "e", "i", "o", "an", "el", "ri", "ol", "ad", "en", "is"],
        endM: [
          "ric", "dan", "mund", "win", "las", "old", "thor", "ion", "bert", "ven", "rin", "dor",
          "mir", "gar", "tan", "vald", "red", "wick", "rath", "aric", "ard", "ulf", "ian", "ius"
        ],
        endF: [
          "a", "wyn", "elle", "ia", "ra", "is", "eth", "ine", "wen", "ara", "issa", "ora",
          "ys", "enne", "ina", "ella", "anna", "yth", "ira", "aine", "ette", "ise", "una", "ea"
        ],
        epi: [
          "the Unhurried", "the Bright", "the Patient", "the Kind", "the Bold", "the Quiet", "the Wise", "the Gentle",
          "the Brave", "the Fair", "the Restless", "the Clever", "the Merciful", "the Dreamer", "the Mapmaker",
          "the Lantern-Bearer", "the Twice-Crowned", "the Unbroken", "the Late", "the Early Riser", "the Well-Read",
          "the Fearless", "the Great", "the Small", "the Golden-Haired", "the Silver-Tongued", "the Iron-Willed",
          "the Seafarer", "the Weathered", "the Moonborn", "the Star-Eyed", "the Lucky", "the Undaunted",
          "the Curious", "the Generous", "the Stubborn", "the Second", "the Third", "the Last", "the Beloved",
          "of the Seven Lakes", "of the North", "of the Silver Coast", "of the Quiet Hills", "of the Stone Tower",
          "of the Mist", "of the Two Rivers", "of the Last Lighthouse", "of the Dawn", "of the Twilight",
          "of the Northern Isles", "of the Valley of Winds", "of the Golden Wood", "of the Long Winter"
        ]
      },
      el: {
        start: [
          "Αλ", "Αρ", "Βα", "Βε", "Γα", "Δα", "Δρα", "Ελ", "Θα", "Θε", "Ια", "Κα", "Κλε", "Κο",
          "Λα", "Λυ", "Μα", "Με", "Μυ", "Να", "Νε", "Ορ", "Πε", "Πο", "Ρα", "Ρο", "Σα", "Σε",
          "Συ", "Τα", "Τε", "Φα", "Φι", "Χα", "Χρυ", "Ευ"
        ],
        mid: ["", "", "", "ρι", "λε", "να", "δο", "ρα", "μι", "θε", "λα", "νο", "βε", "σι", "κα"],
        endM: [
          "ρίνος", "λάνδρος", "δώνας", "μάρης", "θέας", "ρίων", "λάνθης", "ντίκος", "ρόλης", "σάμος",
          "λάκης", "ρίμος", "νέλιος", "λέων", "δάρος", "νίδας", "μίλος", "βάρος", "κλέας", "στράτης",
          "φώντας", "γόρας", "τίμος", "μήδης"
        ],
        endF: [
          "ρίνα", "λένη", "δώρα", "μέλια", "θέα", "ρίσα", "λάνθη", "νίκη", "ρόλα", "σάμη",
          "λίδα", "ρίμα", "νέλια", "λώνη", "δάρα", "νίδα", "μίλα", "βέλα", "θούσα", "κλέα",
          "φώ", "γόνη", "τίμη", "μήδη"
        ],
        // [masculine, feminine]; the article is added by names.js
        epiAdj: [
          ["Αβίαστος", "Αβίαστη"], ["Λαμπερός", "Λαμπερή"], ["Υπομονετικός", "Υπομονετική"],
          ["Καλόκαρδος", "Καλόκαρδη"], ["Τολμηρός", "Τολμηρή"], ["Σιωπηλός", "Σιωπηλή"],
          ["Σοφός", "Σοφή"], ["Ήπιος", "Ήπια"], ["Γενναίος", "Γενναία"], ["Δίκαιος", "Δίκαιη"],
          ["Ανήσυχος", "Ανήσυχη"], ["Πανέξυπνος", "Πανέξυπνη"], ["Μεγαλόψυχος", "Μεγαλόψυχη"],
          ["Ονειροπόλος", "Ονειροπόλα"], ["Αήττητος", "Αήττητη"], ["Αργοπορημένος", "Αργοπορημένη"],
          ["Πολυδιαβασμένος", "Πολυδιαβασμένη"], ["Ατρόμητος", "Ατρόμητη"], ["Μεγάλος", "Μεγάλη"],
          ["Μικρός", "Μικρή"], ["Χρυσόμαλλος", "Χρυσόμαλλη"], ["Ασημένιος", "Ασημένια"],
          ["Σιδερένιος", "Σιδερένια"], ["Θαλασσινός", "Θαλασσινή"], ["Ανεμοδαρμένος", "Ανεμοδαρμένη"],
          ["Φεγγαρογέννητος", "Φεγγαρογέννητη"], ["Καλότυχος", "Καλότυχη"], ["Ακατάβλητος", "Ακατάβλητη"],
          ["Φιλομαθής", "Φιλομαθής"], ["Περίεργος", "Περίεργη"], ["Γενναιόδωρος", "Γενναιόδωρη"],
          ["Πεισματάρης", "Πεισματάρα"], ["Δεύτερος", "Δεύτερη"], ["Τρίτος", "Τρίτη"],
          ["Τελευταίος", "Τελευταία"], ["Αγαπημένος", "Αγαπημένη"], ["Χαρτογράφος", "Χαρτογράφος"],
          ["Θαλασσοπόρος", "Θαλασσοπόρος"], ["Πρωινός", "Πρωινή"], ["Λαμπαδηφόρος", "Λαμπαδηφόρος"]
        ],
        epiOf: [
          "των Επτά Λιμνών", "του Βορρά", "της Ασημένιας Ακτής", "των Ήσυχων Λόφων", "του Πέτρινου Πύργου",
          "της Ομίχλης", "των Δύο Ποταμών", "του Τελευταίου Φάρου", "της Αυγής", "του Λυκόφωτος",
          "των Βόρειων Νησιών", "της Κοιλάδας των Ανέμων", "του Χρυσού Δάσους", "του Μεγάλου Χειμώνα"
        ]
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = W;
  else root.NAME_WORDS = W;
})(this);
