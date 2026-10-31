// ============================================================
// orOS Typing Tutor: practice words and sentences (pure data)
// i18n-inline-ok: Greek and German practice words and sentences, the lesson material itself, no UI text
// Own lists written for orOS (common everyday words, no list copied
// from elsewhere). The course keeps only the words a lesson's keys can
// type, so the lists mix short and long words with every letter.
// German nouns keep their capital letter: they appear only once the
// Shift lesson is done.
// ============================================================
(function (root) {
  "use strict";

  function split(s) { return s.trim().split(/\s+/); }

  var WORDS = {
    en: split(
      "a as ad add all ask ads lad sad dad fad fall hall lass glass flask salad gas has had " +
      "half shall flash slash dash gash hash lash sash ash jag lag hag sag flag shag " +
      "the be to of and in that have it for not on with he as you do at this but his by from " +
      "they we say her she or an will my one all would there their what so up out if about who " +
      "get which go me when make can like time no just him know take people into year your good " +
      "some could them see other than then now look only come its over think also back after use " +
      "two how our work first well way even new want because any these give day most us is was are " +
      "were been has had did said made went got came took saw knew thought found told asked " +
      "here where why yes ok very much more many such long little own right still old great small " +
      "large big high low last next early young important few public bad same able " +
      "home house room door window table chair bed kitchen garden street city town country world " +
      "water food bread milk tea coffee sugar salt apple orange lemon egg fish meat rice soup " +
      "cake cheese butter honey juice dinner lunch breakfast morning evening night today tomorrow " +
      "week month spring summer autumn winter rain snow wind sun moon star sky sea river lake hill " +
      "tree flower grass leaf stone sand road bridge train bus car bike ship plane map ticket " +
      "friend family mother father sister brother child children baby man woman girl boy name " +
      "book page letter word story paper pen pencil desk school class lesson teacher student " +
      "music song dance game play team ball goal win lose start stop open close read write speak " +
      "listen learn teach help need keep let begin seem feel try leave call put mean become show " +
      "hear run move live believe hold bring happen stand lose pay meet include continue set change " +
      "lead understand watch follow create spend grow offer remember love consider appear buy wait " +
      "serve die send expect build stay fall cut reach kill remain suggest raise pass sell require " +
      "report decide pull walk sit talk turn hand head face eye ear nose mouth hair arm leg foot " +
      "heart body voice color red blue green yellow black white brown pink gray dark light warm " +
      "cold hot cool soft hard quick slow easy simple clear quiet loud happy sad kind brave calm " +
      "fresh clean sweet sharp deep wide full empty rich poor safe free real true fair fine " +
      "dog cat bird horse cow sheep duck fox wolf bear lion mouse rabbit frog bee fly " +
      "job desk task plan idea fact case point group problem place question number system program " +
      "money price shop market bank office computer phone screen keyboard mouse file folder email " +
      "jazz quiz fizz buzz zoo zero zone zip lazy crazy size prize maze puzzle " +
      "box fox six mix fix tax wax next text extra exact " +
      "quick quite queen quiet quote square equal liquid " +
      "joy jump just job joke juice jacket jelly major enjoy " +
      "very visit voice value video seven over even never level river cover"),
    el: split(
      "και να το τα η ο οι με σε για θα δεν από που είναι ένα μια στο στη στην στα στον " +
      "τον την της του των τους τις αλλά ή αν ως πως όπως μας σας μου σου του της " +
      "εγώ εσύ αυτός αυτή αυτό εμείς εσείς αυτοί ναι όχι εδώ εκεί τώρα μετά πριν πάντα ποτέ " +
      "σήμερα αύριο χθες πολύ λίγο καλά κακά μαζί μόνο ακόμα ήδη ίσως πάλι έξω μέσα πάνω κάτω " +
      "άλλος άλλη άλλο όλος όλη όλο κάθε κάτι κάποιος τίποτα κανείς πού πότε γιατί ποιος τι " +
      "σαλάτα σάλα λάδι δάφνη γάλα αλάτι φάκα σκάλα σφάλμα δάσκαλος " +
      "λαός φασκόμηλο σκάφος κάδος λάκκος " +
      "σπίτι πόρτα παράθυρο τραπέζι καρέκλα κρεβάτι κουζίνα κήπος δρόμος πόλη χωριό χώρα κόσμος " +
      "νερό φαγητό ψωμί γάλα τσάι καφές ζάχαρη αλάτι μήλο πορτοκάλι λεμόνι αυγό ψάρι κρέας ρύζι " +
      "σούπα τυρί βούτυρο μέλι χυμός δείπνο μεσημέρι πρωί βράδυ νύχτα μέρα εβδομάδα μήνας χρόνος " +
      "άνοιξη καλοκαίρι φθινόπωρο χειμώνας βροχή χιόνι αέρας ήλιος φεγγάρι αστέρι ουρανός θάλασσα " +
      "ποτάμι λίμνη λόφος βουνό δέντρο λουλούδι χόρτο φύλλο πέτρα άμμος γέφυρα τρένο λεωφορείο " +
      "αυτοκίνητο ποδήλατο πλοίο αεροπλάνο χάρτης εισιτήριο φίλος φίλη οικογένεια μητέρα πατέρας " +
      "αδελφή αδελφός παιδί παιδιά μωρό άντρας γυναίκα κορίτσι αγόρι όνομα βιβλίο σελίδα γράμμα " +
      "λέξη ιστορία χαρτί στυλό μολύβι θρανίο σχολείο τάξη μάθημα δάσκαλος μαθητής μαθήτρια " +
      "μουσική τραγούδι χορός παιχνίδι ομάδα μπάλα νίκη αρχή τέλος ανοίγω κλείνω διαβάζω γράφω " +
      "μιλάω ακούω μαθαίνω διδάσκω βοηθάω θέλω μπορώ ξέρω κάνω λέω πάω έρχομαι βλέπω τρώω πίνω " +
      "δίνω παίρνω βάζω αφήνω ψάχνω βρίσκω χάνω κερδίζω αγοράζω πουλάω πληρώνω δουλεύω παίζω " +
      "τρέχω περπατάω κάθομαι σηκώνομαι κοιμάμαι ξυπνάω αγαπάω νιώθω σκέφτομαι θυμάμαι ξεχνάω " +
      "χέρι κεφάλι πρόσωπο μάτι αυτί μύτη στόμα μαλλιά πόδι καρδιά σώμα φωνή χρώμα κόκκινο " +
      "μπλε πράσινο κίτρινο μαύρο άσπρο καφέ ροζ γκρι σκούρο ανοιχτό ζεστό κρύο μαλακό σκληρό " +
      "γρήγορα αργά εύκολο απλό καθαρό ήσυχο χαρούμενος λυπημένος ήρεμος γενναίος φρέσκος " +
      "γλυκός βαθύς πλατύς γεμάτος άδειος πλούσιος φτωχός ασφαλής ελεύθερος αληθινός ωραίος " +
      "μεγάλος μικρός ψηλός χαμηλός παλιός νέος καινούριος καλός κακός πρώτος τελευταίος " +
      "σκύλος γάτα πουλί άλογο αγελάδα πρόβατο πάπια αλεπού λύκος αρκούδα λιοντάρι ποντίκι " +
      "κουνέλι βάτραχος μέλισσα μύγα δουλειά γραφείο ιδέα σχέδιο πρόβλημα ερώτηση απάντηση " +
      "αριθμός χρήματα τιμή μαγαζί αγορά τράπεζα υπολογιστής τηλέφωνο οθόνη πληκτρολόγιο αρχείο " +
      "φάκελος ξύλο ξένος ξανά ξέρω ψωμί ψηλά ψάρι ζωή ζώο ζέστη ζάχαρη χαρά χαμόγελο " +
      "θέα θέμα θέση θάρρος ήχος ώρα ώμος ωραία ευχή ευχαριστώ παρακαλώ συγγνώμη γεια " +
      "πρόγραμμα ταξίδι διακοπές καλοκαιρινός παραλία κύμα βάρκα ψαράς λιμάνι νησί " +
      "ελιά σύκο σταφύλι καρπούζι πεπόνι ντομάτα αγγούρι πατάτα κρεμμύδι σκόρδο " +
      "τσάντα παπούτσι φόρεμα πουκάμισο παντελόνι καπέλο γυαλιά ρολόι κλειδί πορτοφόλι " +
      "προϊόν πρωτεΐνη ευφυΐα αϋπνία κορόιδο τρόλεϊ ρολόι πλαϊνός"),
    de: split(
      "der die das und in zu den von mit sich des auf ist im dem nicht ein eine als auch es an " +
      "er so dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben " +
      "nur oder aber vor zur bis mehr durch man sein wurde sei hat ich du wir ihr wo was wer " +
      "wann warum wie hier dort jetzt heute morgen immer nie oft schon gern sehr viel wenig gut " +
      "schlecht ganz alle alles jeder kein keine etwas nichts ja nein bitte danke hallo " +
      "das fass lass alfa falls salsa saft kraft gas glas hals " +
      "gehen kommen sehen machen sagen geben nehmen finden denken wissen lassen stehen liegen " +
      "bleiben heißen halten bringen leben fahren laufen lesen schreiben sprechen hören lernen " +
      "lehren helfen brauchen kaufen verkaufen zahlen spielen arbeiten wohnen schlafen essen " +
      "trinken kochen backen singen tanzen lachen weinen warten suchen öffnen schließen " +
      "groß klein alt neu jung lang kurz hoch tief warm kalt heiß kühl hell dunkel schnell " +
      "langsam leicht schwer einfach klar ruhig laut leise froh traurig müde wach schön " +
      "frisch sauber süß sauer bitter voll leer reich arm sicher frei wahr richtig falsch " +
      "rot blau grün gelb schwarz weiß braun grau bunt " +
      "über für müssen können dürfen mögen möchten würde hätte wäre schön grün böse " +
      "größe straße fuß gruß maß spaß weiß heiß süß groß bloß " +
      "Haus Tür Fenster Tisch Stuhl Bett Küche Garten Straße Stadt Dorf Land Welt Wasser " +
      "Essen Brot Milch Tee Kaffee Zucker Salz Apfel Ei Fisch Fleisch Reis Suppe Kuchen Käse " +
      "Butter Honig Saft Abend Nacht Tag Woche Monat Jahr Frühling Sommer Herbst Winter Regen " +
      "Schnee Wind Sonne Mond Stern Himmel Meer Fluss See Berg Baum Blume Gras Blatt Stein " +
      "Sand Weg Brücke Zug Bus Auto Fahrrad Schiff Flugzeug Karte Freund Freundin Familie " +
      "Mutter Vater Schwester Bruder Kind Kinder Baby Mann Frau Mädchen Junge Name Buch Seite " +
      "Brief Wort Geschichte Papier Stift Schule Klasse Lehrer Musik Lied Tanz Spiel Ball " +
      "Hand Kopf Gesicht Auge Ohr Nase Mund Haar Arm Bein Herz Stimme Farbe Hund Katze Vogel " +
      "Pferd Kuh Schaf Ente Fuchs Wolf Bär Löwe Maus Hase Frosch Biene Arbeit Büro Idee Plan " +
      "Frage Antwort Zahl Geld Preis Laden Markt Bank Computer Telefon Bildschirm Tastatur Datei " +
      "Ordner Zeit Leben Mensch Leute Teil Ende Anfang Glück Freude Ruhe Reise Urlaub Strand " +
      "zehn zwei drei vier fünf sechs sieben acht neun elf zwölf zwanzig hundert tausend " +
      "quer quelle quark qual " +
      "jahr jede jemand jetzt jung " +
      "vogel viel vier voll vorne vater " +
      "xylofon taxi hexe text " +
      "yacht typ yoga")
  };

  // Short sentences for the review lessons and the end of each lesson.
  var SENTENCES = {
    en: [
      "The sun is warm and the sea is calm today.",
      "We read a good book at home last night.",
      "My friend has a small dog and two cats.",
      "Please close the door when you leave the room.",
      "A quick brown fox jumps over the lazy dog.",
      "She drinks a cup of tea every morning.",
      "The train leaves the city at seven.",
      "Learning to type takes a little time every day.",
      "Keep your eyes on the screen, not on the keys.",
      "Rest your fingers on the home row and breathe.",
      "The children play in the garden after school.",
      "He wrote a long letter to his sister.",
      "We need bread, milk, eggs and some fresh fruit.",
      "It may rain tomorrow, so take a coat.",
      "Good typing is calm, even and steady.",
      "Every key has its own finger.",
      "The old bridge crosses a wide river.",
      "Music fills the quiet house at night.",
      "Jack quietly moved up front and seized the big ball of wax.",
      "Six big juicy steaks sizzled in a pan as five workmen left the quarry."
    ],
    el: [
      "Ο ήλιος είναι ζεστός και η θάλασσα ήρεμη σήμερα.",
      "Διαβάσαμε ένα καλό βιβλίο στο σπίτι χθες βράδυ.",
      "Η φίλη μου έχει ένα μικρό σκύλο και δύο γάτες.",
      "Κλείσε την πόρτα όταν φεύγεις από το δωμάτιο.",
      "Πίνει ένα φλιτζάνι τσάι κάθε πρωί.",
      "Το τρένο φεύγει από την πόλη στις επτά.",
      "Η πληκτρολόγηση θέλει λίγο χρόνο κάθε μέρα.",
      "Κράτα τα μάτια στην οθόνη και όχι στα πλήκτρα.",
      "Άφησε τα δάχτυλα στη μεσαία σειρά και ανάπνευσε.",
      "Τα παιδιά παίζουν στον κήπο μετά το σχολείο.",
      "Έγραψε ένα μεγάλο γράμμα στην αδελφή του.",
      "Θέλουμε ψωμί, γάλα, αυγά και λίγα φρέσκα φρούτα.",
      "Ίσως βρέξει αύριο, πάρε ένα μπουφάν.",
      "Η καλή πληκτρολόγηση είναι ήρεμη και σταθερή.",
      "Κάθε πλήκτρο έχει το δικό του δάχτυλο.",
      "Η παλιά γέφυρα περνάει πάνω από ένα πλατύ ποτάμι.",
      "Η μουσική γεμίζει το ήσυχο σπίτι τη νύχτα.",
      "Ξεσκεπάζω την ψυχοφθόρα βδελυγμία.",
      "Το καΐκι έφυγε νωρίς από το λιμάνι του νησιού.",
      "Το πρωί περπατάμε στην παραλία με τον σκύλο."
    ],
    de: [
      "Die Sonne ist warm und das Meer ist heute ruhig.",
      "Wir haben gestern Abend ein gutes Buch gelesen.",
      "Meine Freundin hat einen kleinen Hund und zwei Katzen.",
      "Bitte schließ die Tür, wenn du den Raum verlässt.",
      "Sie trinkt jeden Morgen eine Tasse Tee.",
      "Der Zug fährt um sieben Uhr aus der Stadt.",
      "Tippen lernen braucht jeden Tag ein wenig Zeit.",
      "Schau auf den Bildschirm und nicht auf die Tasten.",
      "Lass die Finger auf der Grundreihe ruhen und atme.",
      "Die Kinder spielen nach der Schule im Garten.",
      "Er schrieb seiner Schwester einen langen Brief.",
      "Wir brauchen Brot, Milch, Eier und frisches Obst.",
      "Morgen regnet es vielleicht, nimm eine Jacke mit.",
      "Gutes Tippen ist ruhig, gleichmäßig und sicher.",
      "Jede Taste hat ihren eigenen Finger.",
      "Die alte Brücke führt über einen breiten Fluss.",
      "Musik füllt das stille Haus in der Nacht.",
      "Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich.",
      "Fünf große Äpfel liegen süß im Korb.",
      "Am Morgen gehen wir mit dem Hund am Strand spazieren."
    ]
  };

  var API = { WORDS: WORDS, SENTENCES: SENTENCES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingWords = API;
})(typeof window !== "undefined" ? window : globalThis);
