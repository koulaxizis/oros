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
        /* ========== PHYSICAL STREAM — DAYS 6–21 ========== */
    {
      id: "d6-phys", level: "phys", difficulty: 1,
      title: "Count how many pairs of shoes you own",
      why: "Awareness precedes change. Simply knowing your total reveals whether you own 'enough' or 'too much' without judging yet."
    },
    {
      id: "d7-phys", level: "phys", difficulty: 1,
      title: "Identify the one room where clutter bothers you most",
      why: "Energy is finite. Naming the primary friction point gives your minimalism a clear battlefield — not a scattered war."
    },
    {
      id: "d8-phys", level: "phys", difficulty: 2,
      title: "Empty one kitchen cabinet completely, return only what you use weekly",
      why: "We store food 'just in case', then forget it exists. Weekly-use filtering exposes items that have outlived their purpose."
    },
    {
      id: "d9-phys", level: "phys", difficulty: 1,
      title: "Throw away any broken items (pens, toys, electronics you won't repair)",
      why: "Broken objects are ghosts of intentions never fulfilled. Removing them honors the future self who deserves functional tools."
    },
    {
      id: "d10-phys", level: "phys", difficulty: 2,
      title: "Try on five pieces of clothing; donate those that don't fit or flatter you today",
      why: "Holding onto 'someday' bodies betrays who you are now. Dressing for your actual self builds daily confidence."
    },
    {
      id: "d11-phys", level: "phys", difficulty: 1,
      title: "Clear your coffee table or main eating surface entirely",
      why: "Shared surfaces become dumping grounds. A clear centerpiece invites conversation, meals, presence — not杂物堆积."
    },
    {
      id: "d12-phys", level: "phys", difficulty: 2,
      title: "Pick up one cardboard box that has been sitting somewhere; either fill it for donation or fold it flat for recycling",
      why: "Boxes waiting to be 'used later' become furniture of procrastination. Deciding now breaks the cycle of indefinite postponement."
    },
    {
      id: "d13-phys", level: "phys", difficulty: 1,
      title: "Remove all receipts from your wallet or purse",
      why: "Receipts expire as soon as they're printed. Keeping them past warranty windows serves no purpose — just mental dust."
    },
    {
      id: "d14-phys", level: "phys", difficulty: 2,
      title: "Go through your coat pockets; remove tickets, napkins, expired gift cards",
      why: "Pockets are black holes for forgotten paper. Emptying them teaches that 'temporary storage' rarely pays off."
    },
    {
      id: "d15-phys", level: "phys", difficulty: 1,
      title: "Place a bowl by the door for stray items (keys, mail, small purchases)",
      why: "A designated landing zone stops clutter from spreading. Small infrastructure beats constant tidying."
    },
    {
      id: "d16-phys", level: "phys", difficulty: 3,
      title: "Clear the top of your fridge or microwave; nothing decorative beyond what you use daily",
      why: "Appliance tops collect decades of debris invisibly. Cleaning them forces confrontation with accumulated neglect."
    },
    {
      id: "d17-phys", level: "phys", difficulty: 2,
      title: "Identify gifts you never use; decide whether to keep for gratitude's sake or let go respectfully",
      why: "Gifts carry emotional debt. Choosing consciously — keeping or releasing — transforms obligation into genuine appreciation."
    },
    {
      id: "d18-phys", level: "phys", difficulty: 1,
      title: "Toss expired medications and cosmetics immediately",
      why: "Old meds are health risks; old makeup breeds bacteria. Safety trumps hoarding sentimentality."
    },
    {
      id: "d19-phys", level: "phys", difficulty: 2,
      title: "Consolidate duplicate tools (four screwdrivers into one good set, ten mugs into six)",
      why: "Duplication is indecision disguised as preparedness. Quality over quantity reduces choice paralysis."
    },
    {
      id: "d20-phys", level: "phys", difficulty: 1,
      title: "Take one photo of a tidy space you've created",
      why: "Documenting wins creates reference points. Future you will thank past you for remembering what calm looks like."
    },
    {
      id: "d21-phys", level: "phys", difficulty: 2,
      title: "Evaluate one hobby; keep materials for active pursuits only, recycle or donate the rest",
      why: "Hobbies we 'should' do but never start become guilt factories. Honesty frees resources for what actually engages us."
    },
	    /* ========== PHYSICAL STREAM — DAYS 22–30 ========== */
    {
      id: "d22-phys", level: "phys", difficulty: 2,
      title: "Empty one closet; keep only what fits without squeezing hangers",
      why: "Oversized closets hide excess. Physical constraint forces honest evaluation of what truly belongs in your wardrobe."
    },
    {
      id: "d23-phys", level: "phys", difficulty: 1,
      title: "Remove magazines or catalogs older than 6 months; recycle them",
      why: "Print media expires silently. Keeping outdated editions clutters shelves without serving current needs."
    },
    {
      id: "d24-phys", level: "phys", difficulty: 2,
      title: "Identify items you bought online but never opened; return or donate immediately",
      why: "Unopened packages are regret in packaging. Processing them now prevents the pile from growing."
    },
    {
      id: "d25-phys", level: "phys", difficulty: 1,
      title: "Wash all bedding, towels, and bath mats; replace any stained or worn",
      why: "Fresh textiles lift daily mood. Worn fabrics signal neglect; replacing them is self-respect."
    },
    {
      id: "d26-phys", level: "phys", difficulty: 2,
      title: "Clear under your bed; nothing stored there unless it's seasonal or infrequently used",
      why: "Under-bed space becomes a graveyard for half-used items. Limiting storage forces conscious decisions."
    },
    {
      id: "d27-phys", level: "phys", difficulty: 3,
      title: "Evaluate one emotional collection (souvenirs, memorabilia); keep only what genuinely moves you",
      why: "Sentimental clutter paralyzes with 'what if'. Curating preserves meaning without drowning in accumulation."
    },
    {
      id: "d28-phys", level: "phys", difficulty: 2,
      title: "Organize cables and cords; label them and store loose ones in bags or boxes",
      why: "Cable chaos causes daily friction. Organization turns tangled frustration into instant accessibility."
    },
    {
      id: "d29-phys", level: "phys", difficulty: 1,
      title: "Clear the counter above your washing machine or dryer; nothing accumulates there",
      why: "Laundry surfaces become storage for incomplete tasks. A clear top reinforces completion rather than delay."
    },
    {
      id: "d30-phys", level: "phys", difficulty: 2,
      title: "Assess one drawer of miscellaneous items; either find homes or discard what has no place",
      why: "Junk drawers are surrender zones. Giving items proper homes or letting them go restores order."
    },

    /* ========== DIGITAL STREAM — DAYS 22–30 ========== */
    {
      id: "d22-dig", level: "dig", difficulty: 2,
      title: "Review browser extensions; disable or remove those unused for 3+ months",
      why: "Extensions consume memory and track activity. Pruning reduces attack surface and improves performance."
    },
    {
      id: "d23-dig", level: "dig", difficulty: 1,
      title: "Clear your clipboard history (most systems store recent clips automatically)",
      why: "Clipboard history leaks sensitive data. Clearing it prevents accidental exposure of copied information."
    },
    {
      id: "d24-dig", level: "dig", difficulty: 2,
      title: "Deactivate old social media accounts you no longer use; delete permanently after 30 days",
      why: "Abandoned accounts are identity fragments. Closing them reduces your digital footprint and vulnerability."
    },
    {
      id: "d25-dig", level: "dig", difficulty: 1,
      title: "Turn off auto-play for videos on social media and news sites",
      why: "Auto-play hijacks attention spans. Disabling it requires conscious choice to continue consuming content."
    },
    {
      id: "d26-dig", level: "dig", difficulty: 2,
      title: "Delete browser autofill data for websites where you shop infrequently",
      why: "Stored payment info encourages impulse buys. Removing it introduces friction that promotes thoughtful spending."
    },
    {
      id: "d27-dig", level: "dig", difficulty: 3,
      title: "Create separate user profiles on your computer for work vs. personal use",
      why: "Blurred boundaries leak distractions. Profile separation creates mental boundaries and reduces context-switching."
    },
    {
      id: "d28-dig", level: "dig", difficulty: 2,
      title: "Review and consolidate duplicate cloud storage folders across Google Drive, Dropbox, etc.",
      why: "Fragmented storage causes version confusion. Centralizing files ensures everyone accesses the current version."
    },
    {
      id: "d29-dig", level: "dig", difficulty: 1,
      title: "Enable two-factor authentication on your most critical accounts (email, banking)",
      why: "Passwords alone are vulnerable. 2FA adds a second barrier that stops most unauthorized access attempts."
    },
    {
      id: "d30-dig", level: "dig", difficulty: 2,
      title: "Review connected apps in your Google/Apple account; revoke access for services you no longer use",
      why: "OAuth tokens grant permanent access. Revoking unused connections limits what can happen if your credentials are compromised."
    },
	    /* ========== PHYSICAL STREAM — DAYS 31–45 ========== */
    {
      id: "d31-phys", level: "phys", difficulty: 2,
      title: "Audit one subscription box (meal kits, beauty products, snacks); cancel if usage is below 50%",
      why: "Subscription inertia wastes money. Canceling underused services redirects funds toward intentional purchases."
    },
    {
      id: "d32-phys", level: "phys", difficulty: 1,
      title: "Remove expired coupons and promotional flyers from your wallet/desk",
      why: "Expired deals create false hope. Purging them eliminates visual clutter and false urgency."
    },
    {
      id: "d33-phys", level: "phys", difficulty: 2,
      title: "Identify and sell or donate electronics you've upgraded (old phones, tablets, cameras)",
      why: "Tech we replace should fund upgrades, not gather dust. Monetizing obsolescence makes room for innovation."
    },
    {
      id: "d34-phys", level: "phys", difficulty: 1,
      title: "Clear out your car's glove compartment and trunk; remove trash and forgotten items",
      why: "Vehicles become mobile storage units unintentionally. Cleaning them restores focus to driving, not navigating clutter."
    },
    {
      id: "d35-phys", level: "phys", difficulty: 2,
      title: "Donate children's toys they've outgrown; keep only favorites and heirloom pieces",
      why: "Toy avalanches overwhelm play spaces. Curating preserves joy without burying creativity in excess."
    },
    {
      id: "d36-phys", level: "phys", difficulty: 1,
      title: "Empty all nightstands completely; return only essentials (book, water glass, lamp)",
      why: "Bedside clutter disrupts sleep environments. Minimal nightstands promote rest and morning clarity."
    },
    {
      id: "d37-phys", level: "phys", difficulty: 2,
      title: "Consolidate overlapping cleaning supplies; keep only what you use regularly",
      why: "Duplicate cleaners waste space and budget. Streamlining reduces decision fatigue when cleaning."
    },
    {
      id: "d38-phys", level: "phys", difficulty: 1,
      title: "Sort incoming mail immediately; shred anything unnecessary, file only what requires action",
      why: "Paper piles compound rapidly. Handling each piece once prevents backlog formation."
    },
    {
      id: "d39-phys", level: "phys", difficulty: 2,
      title: "Evaluate kitchen gadgets; donate appliances you bought but rarely use (juicer, fondue pot)",
      why: "Single-use appliances occupy prime real estate. Letting them go acknowledges how you actually cook."
    },
    {
      id: "d40-phys", level: "phys", difficulty: 3,
      title: "Conduct a full pantry audit; discard expired food, consolidate half-used spices",
      why: "Food expiry goes unnoticed until disposal time. Regular audits save money and reduce waste."
    },
    {
      id: "d41-phys", level: "phys", difficulty: 2,
      title: "Identify furniture items you bought impulsively; decide whether to repurpose, sell, or donate",
      why: "Impulse furniture dominates floor plans. Honest assessment reveals what actually serves your lifestyle."
    },
    {
      id: "d42-phys", level: "phys", difficulty: 1,
      title: "Create a 'one-in-one-out' rule for clothing purchases",
      why: "Unchecked acquisition guarantees overflow. The swap rule maintains equilibrium without restrictive budgets."
    },
    {
      id: "d43-phys", level: "phys", difficulty: 2,
      title: "Organize your medicine cabinet; group by family member or purpose, discard duplicates",
      why: "Disorganized cabinets delay during emergencies. Structure speeds retrieval when urgency strikes."
    },
    {
      id: "d44-phys", level: "phys", difficulty: 1,
      title: "Clean your refrigerator inside and out; toss expired condiments and spoiled leftovers",
      why: "Dirty fridges spread odors and bacteria. Deep cleaning resets both hygiene and visibility of food."
    },
    {
      id: "d45-phys", level: "phys", difficulty: 2,
      title: "Audit one category of sentimental items (letters, cards, children's artwork); digitize or curate",
      why: "Paper memories swell without bound. Digitization preserves meaning without occupying physical space."
    },

    /* ========== DIGITAL STREAM — DAYS 31–45 ========== */
    {
      id: "d31-dig", level: "dig", difficulty: 2,
      title: "Audit digital subscriptions (streaming, software, apps); cancel those unused in 30+ days",
      why: "Recurring charges accumulate invisibly. Cancellation returns money to your control and attention to your choice."
    },
    {
      id: "d32-dig", level: "dig", difficulty: 1,
      title: "Unsubscribe from two more shopping or deal newsletters",
      why: "Each retail email plants seeds of desire. Reducing their volume lowers temptation without effort."
    },
    {
      id: "d33-dig", level: "dig", difficulty: 2,
      title: "Review notification settings for all apps; turn off everything non-critical",
      why: "Most notifications demand attention without delivering value. Silence grants control back to your schedule."
    },
    {
      id: "d34-dig", level: "dig", difficulty: 1,
      title: "Schedule recurring monthly calendar reminders for bill payments and subscriptions",
      why: "Forgetting due dates incurs fees. Automation handles routine financial tasks reliably."
    },
    {
      id: "d35-dig", level: "dig", difficulty: 2,
      title: "Create a 'digital detox' hour each evening (no screens from 7–8 PM as example)",
      why: "Constant connectivity erodes presence. Scheduled disconnection rebuilds attention spans and sleep quality."
    },
    {
      id: "d36-dig", level: "dig", difficulty: 1,
      title: "Organize your phone home screen; keep only daily essentials visible",
      why: "Visible apps trigger habitual checks. Curating the first screen shapes daily digital behavior."
    },
    {
      id: "d37-dig", level: "dig", difficulty: 2,
      title: "Set up automatic email labeling or filing for common senders (bank, medical, work)",
      why: "Manual sorting drains energy daily. Automatic rules handle routine classification instantly."
    },
    {
      id: "d38-dig", level: "dig", difficulty: 3,
      title: "Implement a digital 'inbox zero' policy for all communication channels (Slack, Teams, email)",
      why: "Unprocessed messages compound into overwhelming noise. Inbox zero creates mental clarity through systematic action."
    },
    {
      id: "d39-dig", level: "dig", difficulty: 2,
      title: "Review your Wi-Fi connected devices; disconnect IoT gadgets you no longer use",
      why: "Every connected device is a potential vulnerability. Unplugging reduces your attack surface significantly."
    },
    {
      id: "d40-dig", level: "dig", difficulty: 1,
      title: "Create desktop shortcuts for your 5 most-used apps only",
      why: "Too many shortcuts scatter focus. Limiting access points reduces decision paralysis during work."
    },
    {
      id: "d41-dig", level: "dig", difficulty: 2,
      title: "Audit your credit card statements for duplicate or forgotten charges",
      why: "Billing errors and scams hide in plain sight. Monthly review catches problems before they escalate."
    },
    {
      id: "d42-dig", level: "dig", difficulty: 1,
      title: "Use a password manager to generate unique passwords for all new accounts",
      why: "Password reuse is catastrophic in breaches. Unique credentials contain damage to single accounts."
    },
    {
      id: "d43-dig", level: "dig", difficulty: 2,
      title: "Configure email signatures with minimal, professional information only",
      why: "Oversharing personal details invites unwanted contact. Professional brevity maintains boundaries effectively."
    },
    {
      id: "d44-dig", level: "dig", difficulty: 1,
      title: "Enable grayscale mode on your phone for 24 hours; notice reduced stimulation",
      why: "Color saturates apps with addictive appeal. Grayscale demonstrates how much design manipulates attention."
    },
    {
      id: "d45-dig", level: "dig", difficulty: 2,
      title: "Review app screen time reports; identify which apps drain the most hours",
      why: "Visibility precedes change. Knowing your usage patterns reveals where attention is truly spent."
    },
	
  ]
};