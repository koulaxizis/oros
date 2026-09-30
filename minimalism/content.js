// ============================================================
// orOS Minimalism — Content (Bilingual)
// Deterministic ordering: Day N = floor((dayOfYear % 365)) + 1
// 365 entries per level, difficulty-balanced (no two hard in a row)
// Versioned via ?v= stamp in index.html — no internal version num.
// ============================================================

window.MINIMALISM_CONTENT = {
  en: [
    /* ========== PHYSICAL STREAM ========== */
    {
      id: "d1-phys", level: "phys", difficulty: 1,
      title: "Clear one drawer completely",
      why: "A single cleared space creates immediate momentum. It proves that decluttering is achievable in minutes, not hours — and that feeling lighter starts with the smallest victory."
    },
    {
      id: "d2-phys", level: "phys", difficulty: 2,
      title: "Remove three items you haven't used in 6 months",
      why: "Objects accumulate through inertia, not intention. Removing them breaks the autopilot that lets things linger past their usefulness."
    },
    {
      id: "d3-phys", level: "phys", difficulty: 1,
      title: "Wipe down one surface (countertop, desk, nightstand)",
      why: "Clean surfaces invite presence. When your environment reflects care, your mind follows."
    },
    {
      id: "d4-phys", level: "phys", difficulty: 2,
      title: "Donate one piece of clothing that no longer fits your life",
      why: "Clothes we keep 'just in case' are anchors to who we used to be. Letting go makes room for who we're becoming."
    },
    {
      id: "d5-phys", level: "phys", difficulty: 1,
      title: "Organize one shelf by height or color (your choice)",
      why: "Visual order reduces cognitive load. Even small alignments create a sense of calm that extends outward."
    },

    /* ========== DIGITAL STREAM ========== */
    {
      id: "d1-dig", level: "dig", difficulty: 1,
      title: "Delete 10 unused apps from your phone",
      why: "Each app you don't use is noise — notifications, icons, mental clutter. Removing them shrinks your attention surface."
    },
    {
      id: "d2-dig", level: "dig", difficulty: 2,
      title: "Turn off all non-human notifications (apps, news, promotions)",
      why: "If it isn't from a person, it can wait. Protecting your attention from broadcast noise restores agency over when you pay focus."
    },
    {
      id: "d3-dig", level: "dig", difficulty: 1,
      title: "Clear your browser bookmarks bar to under 7 items",
      why: "A crowded bookmarks bar trains you to scroll instead of search. A sparse one forces intentionality — and often reveals you don't need half of it."
    },
    {
      id: "d4-dig", level: "dig", difficulty: 2,
      title: "Unsubscribe from 5 promotional email lists",
      why: "Marketing emails hijack your inbox and train urgency where there is none. Each unsubscribe reclaims a sliver of your mental bandwidth."
    },
    {
      id: "d5-dig", level: "dig", difficulty: 1,
      title: "Archive all emails older than 90 days from your inbox",
      why: "An empty inbox isn't about productivity — it's about clearing the visual noise that makes important messages harder to find."
    }
    // ... Days 6–365 will be added in batches for your review ...
  ],

  el: [
    /* ========== PHYSICAL STREAM (Φυσικός Μινιμαλισμός) ========== */
    {
      id: "d1-phys", level: "phys", difficulty: 1,
      title: "Άδειασε ένα συρτάρι πλήρως",
      why: "Ένας καθαρισμένος χώρος δημιουργεί άμεση ορμή. Αποδεικνύει ότι η αποχάρτιωση είναι εφικτή σε λεπτά, όχι ώρες — και ότι το αίσθημα της ελαφρότητας ξεκινά από τη μικρότερη νίκη."
    },
    {
      id: "d2-phys", level: "phys", difficulty: 2,
      title: "Αφαίρεσε τρία αντικείμενα που δεν έχεις χρησιμοποιήσει έξι μήνες",
      why: "Τα αντικείμενα συσσωρεύονται μέσω αδράνειας, όχι προθέσεων. Η αφαίρεσή τους σπάει την αυτοματοποίηση που επιτρέπει στα πράγματα να παραμένουν πέρα από τη χρησιμότητά τους."
    },
    {
      id: "d3-phys", level: "phys", difficulty: 1,
      title: "Σκουπίσε μία επιφάνεια (επιφάνεια εργασίας, γραφείο, κομοδίνο)",
      why: "Οι καθαρές επιφάνειες προσκαλούν την παρουσία. Όταν το περιβάλλον αντανακλά φροντίδα, το μυαλό ακολουθεί."
    },
    {
      id: "d4-phys", level: "phys", difficulty: 2,
      title: "Παραδώσε ένα ρούho που δεν ταιριάζει πια στη ζωή σου",
      why: "Τα ρούχα που κρατάμε «για κάθε περίπτωση» είναι άγκυρες σε αυτόν που ήμασταν. Το να τα αφήσουμε κάνει χώρο για όποιον γινόμαστε."
    },
    {
      id: "d5-phys", level: "phys", difficulty: 1,
      title: "Οργάνωσε ένα ράφι ανά ύψος ή χρώμα (εσύ επιλέγεις)",
      why: "Η οπτική τάξη μειώνει το γνωστικό φορτίο. Ακόμη μικρές ευθυγραμμίσεις δημιουργούν μια αίσθηση ηρεμίας που εκτείνεται έξω."
    },

    /* ========== DIGITAL STREAM (Ψηφιακός Μινιμαλισμός) ========== */
    {
      id: "d1-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε 10 μη χρησιμοποιούμενες εφαρμογές από το κινητό",
      why: "Κάθε εφαρμογή που δεν χρησιμοποιείς είναι θόρυβος — ειδοποιήσεις, εικονίδια, νοητική αταξία. Η αφαίρεσή τους συρρικνώνει την επιφάνεια προσοχής σου."
    },
    {
      id: "d2-dig", level: "dig", difficulty: 2,
      title: "Βγάλε όλες τις μη ανθρώπινες ειδοποιήσεις (εφαρμογές, νέα, προωθήσεις)",
      why: "Αν δεν είναι από άνθρωπο, μπορεί να περιμένει. Προστατεύοντας την προσοχή σου από τον θόρυβο των broadcast επαναφέρει την εξουσία στο πότε δίνεις συγκέντρωση."
    },
    {
      id: "d3-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε τη μπάρα σελιδοδεικτών του browser σε λιγότερα από 7 αντικείμενα",
      why: "Ένας γεμάτος μπάρας σελιδοδεικτών σε εκπαιδεύει να scrollάρεις αντί να αναζητάς. Ένας σπάνιος σε αναγκάζει σε σκόπιμη επιλογή — και συχνά αποκαλύπτει ότι δεν χρειάζεσαι το μισό από αυτό."
    },
    {
      id: "d4-dig", level: "dig", difficulty: 2,
      title: "Απόγραιοι από 5 λίστες email προώθησης",
      why: "Τα marketing emails απαγάγουν το inbox σου και εκπαιδεύουν την επείγουσα κατάσταση όπου δεν υπάρχει. Κάθε απόγραωση ανακτά ένα κομμάτι της νοητικής σου ευρυχωρίας."
    },
    {
      id: "d5-dig", level: "dig", difficulty: 1,
      title: "Αρχειοθέτησε όλα τα email старше από 90 ημέρες από το inbox",
      why: "Ένα άδειο inbox δεν αφορά την παραγωγικότητα — αφορά το να καθαρίσεις το οπτικό θόρυβο που κάνει τα σημαντικά μηνύματα πιο δύσκολα βρέσιμα."
    }
    // ... Μέρες 6–365 θα προστεθούν σε παρτίδες για την έγκρισή σου ...
  ]
};