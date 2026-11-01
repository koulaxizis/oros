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

  // Wave 3: more everyday words (still own lists), so the later lessons
  // and the speed tests repeat less.
  var MORE = {
    en: split(
      "about above across act add age ago agree air allow almost alone along already always amount " +
      "animal answer appear area arm army around arrive art article attack aunt baby bag ball band " +
      "base basket bath battle beach bean beat beauty become begin behind believe bell belt bench " +
      "best better between bike bill birth bit bite blank block blood blow board boat bone book boot " +
      "born both bottle bottom bowl brain branch brick bridge bright bring broad brother brush build " +
      "burn bus busy button buy cable call camp card care carry cart catch cause cell center chain " +
      "chance change charge cheap check chest chicken child choice choose church circle class clock " +
      "close cloth cloud club coat coin collect come common cook copy corner cost cotton count " +
      "course cousin cover cream cross crowd cry cup cut daily damage dance danger date daughter " +
      "dead deal dear decide degree design detail die dinner direction dirty dish doctor dollar " +
      "double down draw dream dress drink drive drop dry during duty each ear earth east eat edge " +
      "effect eight either else empty end energy engine enough enter evening event ever every " +
      "example eye face factory fail fair family famous far farm fast father fear feel field fight " +
      "figure fill film final find finger finish fire floor flower fly fold follow foot force forest " +
      "forget form forward four friend front fruit fun future game gate gift girl glad goal gold " +
      "grass gray ground grow guess guest guide hair hand hang happen hat head health hear heavy " +
      "help hide history hold hole holiday hope horse hospital hotel hour hunt hurry husband ice " +
      "inch include inside iron island item join judge keep key kid king kiss knee knife knock lady " +
      "land language late laugh law lead learn leave left leg lend less letter lie life lift line " +
      "lip list listen live lock lose lot love lunch machine main man map mark match matter meal " +
      "mean measure meet member memory middle mile mind minute miss moment monday mother mountain " +
      "mouth move music name narrow nature near neck need neighbor nest net news nice nine noise " +
      "noon north nose note nothing notice nurse oil open order page paint pair paper parent park " +
      "part party pass past path pay peace pen pencil person pick picture piece pink pipe plant " +
      "plate play please pocket poem pool pour power present press pretty print pull push put " +
      "quarter race radio reach read ready reason record remember repeat rest return ring road " +
      "rock roll roof root rope rose round row rule run salt sand save school score season seat " +
      "second secret sell send sense serve set seven shape share sheet shelf shine ship shirt shoe " +
      "short shout show shut sick side sign silver sing sister sit skin skirt sleep smile smoke " +
      "snake sock soft soldier son song sound south space speak speed spend spoon sport spot stage " +
      "stair stand start state station stay steel step stick stone stop store storm story strong " +
      "student study sudden summer supper sure surprise swim talk tall taste teach team tell ten " +
      "thank thick thin thing third thirty though three throw ticket tie tiny tired toe together " +
      "tool tooth top touch tower toy track train travel tree trip trouble truck try turn twelve " +
      "uncle under until upon usual valley village visit wait wake walk wall wash watch wave wear " +
      "weather wedding west wet wheel while whole wife wild win wing winter wish woman wonder wood " +
      "word worry write wrong yard yellow yesterday zebra"),
    el: split(
      "αέρας αγκαλιά άγκυρα αγώνας αδύνατος αίμα αίθουσα αλήθεια αλλαγή αμάξι ανάγκη ανατολή " +
      "ανεβαίνω άνθρωπος αντίο απόγευμα απόφαση αργότερα αριστερά αρκετά αρχίζω ασθενής αστείο " +
      "αυλή αφού βάθος βαλίτσα βάρος βασιλιάς βήμα βιβλιοθήκη βοήθεια βόρεια βράχος βρύση γαλάζιο " +
      "γάμος γειτονιά γέλιο γεύση γη γιαγιά γιατρός γλώσσα γνώμη γονείς γραμμή γρήγορος γυαλί γωνία " +
      "δάχτυλο δεξιά δέρμα δευτέρα δίπλα δοκιμή δρόμος δύναμη δύσκολο δώρο δωμάτιο εικόνα είδος " +
      "εισοδος εκδρομή εκκλησία ελάχιστα ελπίδα εμπρός ενώ εξήγηση επάγγελμα επιστολή εποχή εργασία " +
      "έρχεται ευκαιρία ζακέτα ζωγραφική ζωντανός ηλικία ημέρα ήρωας θείος θεία θερμοκρασία θόρυβος " +
      "θυμός ιατρείο ίδιος ισχυρός καθαρίζω καθρέφτης καιρός καλάθι καλημέρα καλησπέρα καλοσύνη " +
      "καπνός καράβι καρδούλα κατάστημα κάστρο κερί κεφάλαιο κιθάρα κινητό κλαδί κλείδωμα κόκαλο " +
      "κόλπος κομμάτι κορυφή κουβέντα κουτί κρασί κύκλος κυριακή λάθος λαιμός λαχανικά λεπτό " +
      "λευκός λιβάδι λίγα λόγος λουλουδάκι λύση μάγουλο μαθηματικά μακριά μαλακός μάρμαρο μαχαίρι " +
      "μέγεθος μέλλον μέση μέτρο μηχανή μικρό μισό μνήμη μόλις μονοπάτι μοναξιά μπαμπάς μπουκάλι " +
      "νησάκι νίκη νόημα νότια νοσοκομείο ντουλάπα ντροπή ξεκινάω ξενοδοχείο ξύπνιος όμορφος " +
      "όνειρο οπωροπωλείο ορίζοντας ουρά πάγος παζάρι παλάμη παππούς παράδειγμα παρέα πάρκο " +
      "πάτωμα πεζοδρόμιο πεινάω πελάτης περιοδικό περίπατος πετάω πετσέτα πιάτο πινακίδα πίσω " +
      "πλατεία πλευρά πνεύμα ποδόσφαιρο πολυθρόνα πονάω πορεία ποσό ποτήρι πουλόβερ πρόβα " +
      "πρόσκληση πρωινό πύργος ράφι ρεύμα ρόδι ρούχα σακάκι σαπούνι σβήνω σειρά σεντόνι σημαία " +
      "σημείο σιγά σκέψη σκιά σκουλαρίκι σοκολάτα σπορ σταθμός στάση στέγη στιγμή στόχος " +
      "συζήτηση συναυλία συνήθεια σύννεφο σύντομα σφουγγάρι σχήμα σωστό ταβάνι ταινία ταμείο " +
      "ταχυδρομείο τέχνη τζάμι τηλεόραση τοίχος τόπος τούρτα τρίτη τριαντάφυλλο τρόπος τσέπη " +
      "τύχη υγεία ύπνος υπόσχεση υφασμα φανάρι φαρμακείο φεγγαράκι φιλί φλιτζάνι φούρνος φούστα " +
      "φράουλα φτερό φυσική φως φωτιά φωτογραφία χαιρετώ χαλί χαρτοπετσέτα χειρουργός χιονάνθρωπος " +
      "χορεύω χρειάζομαι χρόνια χωράφι ψάρεμα ψέμα ψυγείο ψώνια ωκεανός ωραιότατος ώριμος"),
    de: split(
      "aber acht allein also ander antworten auch auf aus außen bald bauen beginnen bekommen " +
      "bereit besser besuchen bezahlen bitten blühen braten breit danken daher damit dann darum " +
      "decken dick dienen doch draußen drehen dünn eben ehrlich eilen einkaufen einladen endlich " +
      "entdecken erklären erzählen fallen fangen fehlen feiern fertig fest feucht fliegen folgen " +
      "fragen fremd fressen freuen früh fühlen füllen ganz gestern gewinnen glauben gleich " +
      "graben greifen gucken halb heben heiraten heizen hinten holen hungrig jagen kaputt kennen " +
      "klettern klingeln klug knapp kosten kräftig kriechen lächeln lecker legen leihen lieb " +
      "lieben loben malen manchmal meinen merken mischen mitten modern nähen nass nett neben " +
      "nennen niemand noch nützlich oben packen passen pflanzen plötzlich putzen rechnen reden " +
      "regnen reiten rennen retten riechen rufen ruhen rund sammeln satt schauen schenken " +
      "schicken schieben schlagen schmecken schneiden schneien schütteln schwimmen segeln senden " +
      "setzen sitzen sofort sogar sparen später spitz springen stark stecken steigen still " +
      "stören streiten stumm tragen treffen treiben trocken tun üben unten vergessen verlieren " +
      "verstehen viele vorbei wachsen wählen wandern waschen wechseln wecken weich weit wenden " +
      "werfen wichtig wieder wild winken wohl wünschen zählen zeichnen zeigen ziehen zurück " +
      "Abend Ahnung Ampel Angst Apotheke Ast Aufgabe Ausflug Badewanne Bahnhof Ball Bauch Becher " +
      "Besuch Bild Birne Blitz Boden Boot Bürger Dach Decke Ding Donner Durst Ecke Eimer Eis " +
      "Eltern Erde Ergebnis Fahne Feder Feld Fest Feuer Film Finger Flasche Flügel Form Gabel " +
      "Gast Gebäude Geburtstag Gedicht Gefühl Gemüse Geschenk Gesundheit Glocke Gold Gras " +
      "Großmutter Großvater Hafen Hals Hemd Hilfe Hof Höhle Hose Hunger Hut Insel Jacke Kamm " +
      "Kanne Kartoffel Kasten Kerze Kirche Kirsche Kissen Kleid Knie Knopf Koffer Korb Kreis " +
      "Krone Kuss Lampe Leiter Licht Löffel Luft Mantel Märchen Mauer Messer Minute Mittag " +
      "Möbel Mühle Mütze Nachbar Nadel Nebel Nest Netz Nudel Obst Onkel Paket Park Pause " +
      "Pflaster Pilz Platz Puppe Rad Rathaus Raum Rose Rücken Sack Schal Schatten Schere " +
      "Schlüssel Schnecke Schrank Schuh Schwein Seife Sessel Socke Spiegel Sport Stall Stiefel " +
      "Strom Stück Stunde Tante Tasche Tasse Teller Tier Topf Treppe Tuch Turm Uhr Ufer Vase " +
      "Wald Wand Wange Welle Wetter Wiese Wolke Wurst Zahn Zaun Zeitung Zimmer Zitrone Zwiebel")
  };
  ["en", "el", "de"].forEach(function (l) { WORDS[l] = WORDS[l].concat(MORE[l]); });

  // Kids mode (wave 3): short, friendly words a child knows (animals,
  // colours, food, family, toys). Lower case, so they fit before the
  // Shift lesson; German nouns come with their capital and appear after it.
  var KIDS = {
    en: split(
      "cat dog cow pig hen duck fish frog bee fox owl bear lion tiger horse sheep goat mouse " +
      "red blue green pink black white gold " +
      "apple pear plum milk cake jam egg rice soup bread juice honey " +
      "mom dad baby sister brother friend " +
      "ball doll kite game toy book drum bike car boat train " +
      "sun moon star rain snow tree leaf sea sand " +
      "run jump play sing draw read hop skip smile hug fun yes"),
    el: split(
      "γάτα σκύλος αγελάδα γουρούνι κότα πάπια ψάρι βάτραχος μέλισσα αλεπού κουκουβάγια " +
      "αρκούδα λιοντάρι τίγρη άλογο πρόβατο κατσίκα ποντίκι " +
      "κόκκινο μπλε πράσινο ροζ μαύρο άσπρο " +
      "μήλο αχλάδι γάλα κέικ μέλι αυγό ρύζι σούπα ψωμί χυμός " +
      "μαμά μπαμπάς μωρό αδελφή αδελφός φίλος φίλη " +
      "μπάλα κούκλα χαρταετός παιχνίδι βιβλίο τύμπανο ποδήλατο τρένο βάρκα " +
      "ήλιος φεγγάρι αστέρι βροχή χιόνι δέντρο φύλλο θάλασσα άμμος " +
      "τρέχω πηδάω παίζω τραγουδάω ζωγραφίζω διαβάζω χαρά ναι"),
    de: split(
      "ja nein rot blau grün gelb rosa schwarz weiß " +
      "laufen springen spielen singen malen lesen lachen hüpfen " +
      "Katze Hund Kuh Schwein Huhn Ente Fisch Frosch Biene Fuchs Eule Bär Löwe Tiger Pferd " +
      "Schaf Ziege Maus Apfel Birne Milch Kuchen Ei Reis Suppe Brot Saft Honig " +
      "Mama Papa Baby Schwester Bruder Freund Ball Puppe Drachen Spiel Buch Trommel Rad " +
      "Auto Boot Zug Sonne Mond Stern Regen Schnee Baum Blatt Meer Sand")
  };

  var API = { WORDS: WORDS, SENTENCES: SENTENCES, KIDS: KIDS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingWords = API;
})(typeof window !== "undefined" ? window : globalThis);
