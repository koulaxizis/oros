// ============================================================
// orOS Minimalism — Content (Bilingual)
// Deterministic ordering: Day N = floor((dayOfYear % 365)) + 1
// 365 entries per level, difficulty-balanced (no two hard in a row)
// Versioned via ?v= stamp in index.html — no internal version num.
// Current coverage: Days 1–55 (both levels, EN+EL).
// Shorter arrays wrap via modulo — partial coverage never crashes.
// ============================================================

window.MINIMALISM_CONTENT = {
  en: [
    /* ========== PHYSICAL STREAM — DAYS 1–30 ========== */
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
    {
      id: "d6-phys", level: "phys", difficulty: 1,
      title: "Count how many pairs of shoes you own",
      why: "Awareness precedes change. Simply knowing your total reveals whether you own 'enough' or 'too much' — without judging anything yet."
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
      title: "Throw away broken items you won't repair (pens, toys, electronics)",
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
      why: "Shared surfaces become dumping grounds. A clear centerpiece invites conversation, meals, presence — not stacks of clutter."
    },
    {
      id: "d12-phys", level: "phys", difficulty: 2,
      title: "Pick up one cardboard box that has been sitting somewhere; fill it for donation or fold it flat for recycling",
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
      why: "Appliance tops collect decades of invisible debris. Cleaning them forces confrontation with accumulated neglect."
    },
    {
      id: "d17-phys", level: "phys", difficulty: 2,
      title: "Identify gifts you never use; decide whether to keep them for gratitude's sake or let go respectfully",
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
      title: "Identify items you bought online but never opened; return or donate them immediately",
      why: "Unopened packages are regret in packaging. Processing them now prevents the pile from growing."
    },
    {
      id: "d25-phys", level: "phys", difficulty: 1,
      title: "Wash all bedding, towels, and bath mats; replace any stained or worn",
      why: "Fresh textiles lift daily mood. Worn fabrics signal neglect; replacing them is self-respect."
    },
    {
      id: "d26-phys", level: "phys", difficulty: 2,
      title: "Clear under your bed; nothing stored there unless seasonal or infrequently used",
      why: "Under-bed space becomes a graveyard for half-used items. Limiting storage forces conscious decisions."
    },
    {
      id: "d27-phys", level: "phys", difficulty: 3,
      title: "Evaluate one sentimental collection (souvenirs, memorabilia); keep only what genuinely moves you",
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
	    /* ========== PHYSICAL STREAM — DAYS 31–55 ========== */
    {
      id: "d31-phys", level: "phys", difficulty: 2,
      title: "Audit one subscription box (meal kits, beauty products, snacks); cancel if usage is below 50%",
      why: "Subscription inertia wastes money. Canceling underused services redirects funds toward intentional purchases."
    },
    {
      id: "d32-phys", level: "phys", difficulty: 1,
      title: "Remove expired coupons and promotional flyers from your wallet or desk",
      why: "Expired deals create false hope. Purging them eliminates visual clutter and false urgency."
    },
    {
      id: "d33-phys", level: "phys", difficulty: 2,
      title: "Sell or donate electronics you've upgraded (old phones, tablets, cameras)",
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
    {
      id: "d46-phys", level: "phys", difficulty: 1,
      title: "Establish a 10-minute nightly reset ritual for your main living space",
      why: "Small daily maintenance prevents weekend marathons. Ten minutes of evening resetting keeps clutter permanently at bay."
    },
    {
      id: "d47-phys", level: "phys", difficulty: 2,
      title: "Create a donation station (a box or bag in a fixed spot) for ongoing letting-go",
      why: "Without a designated exit point, outgoing items stall in limbo. Infrastructure turns good intentions into completed actions."
    },
    {
      id: "d48-phys", level: "phys", difficulty: 1,
      title: "Assign every item in your entryway a permanent home (keys, sunglasses, bags)",
      why: "Entry chaos sets the tone for the whole home. Fixed homes eliminate the daily hunt-and-drop cycle."
    },
    {
      id: "d49-phys", level: "phys", difficulty: 2,
      title: "Adopt the 'touch it once' rule for household paper (mail, school forms, receipts)",
      why: "Handling papers repeatedly wastes attention repeatedly. Single-touch processing keeps surfaces clear permanently."
    },
    {
      id: "d50-phys", level: "phys", difficulty: 1,
      title: "Do a 5-item sweep before bed: find five misplaced items and return each to its home",
      why: "Micro-tidying compounds. Five items nightly equals 1,825 returns per year — entropy quietly defeated."
    },
    {
      id: "d51-phys", level: "phys", difficulty: 2,
      title: "Set up a 'launchpad' by the door with tomorrow's essentials (bag, wallet, chargers)",
      why: "Morning decisions drain willpower. Preparing tonight means starting tomorrow already in motion."
    },
    {
      id: "d52-phys", level: "phys", difficulty: 1,
      title: "Designate one 'everything drawer' — and accept that it exists",
      why: "Perfectionism kills minimalism. One sanctioned chaos-zone prevents guilt while keeping the rest of the home intentional."
    },
    {
      id: "d53-phys", level: "phys", difficulty: 2,
      title: "Review your cleaning supplies storage; keep only one of each type of product",
      why: "Multiple half-full bottles create clutter and confusion. Consolidation makes maintenance predictable."
    },
    {
      id: "d54-phys", level: "phys", difficulty: 1,
      title: "Photograph one 'before' area from Week 1; compare it to today",
      why: "Progress is invisible day-to-day. Evidence sustains motivation when the journey feels stagnant."
    },
    {
      id: "d55-phys", level: "phys", difficulty: 2,
      title: "Write your personal 'enough' definition: how many plates, towels, shirts are YOUR enough",
      why: "Without an upper limit, accumulation is infinite. Defining 'enough' is the philosophical foundation of every future decision."
    },
	    /* ========== DIGITAL STREAM — DAYS 1–30 ========== */
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
    },
    {
      id: "d6-dig", level: "dig", difficulty: 1,
      title: "Unsubscribe from one shopping newsletter",
      why: "Retail emails manufacture desire where there is none. One less subscription means fewer manufactured urgencies."
    },
    {
      id: "d7-dig", level: "dig", difficulty: 1,
      title: "Delete screenshots you took months ago and never looked at",
      why: "Screenshots are digital junk drawers. They capture moments without context, collecting pixels without purpose."
    },
    {
      id: "d8-dig", level: "dig", difficulty: 2,
      title: "Log out of websites you haven't visited in 6+ months; revoke their access where possible",
      why: "Logged-in sessions are digital invitations for data tracking. Revoking access tightens your security perimeter."
    },
    {
      id: "d9-dig", level: "dig", difficulty: 1,
      title: "Turn off read receipts for messaging apps if you find them anxiety-inducing",
      why: "Read receipts create invisible obligations. Your attention belongs to you, not to other people's expectations."
    },
    {
      id: "d10-dig", level: "dig", difficulty: 2,
      title: "Audit your password manager; merge duplicate accounts, delete old login entries",
      why: "Duplicate passwords multiply breach surfaces. Cleaning the vault protects future access without multiplying risk."
    },
    {
      id: "d11-dig", level: "dig", difficulty: 1,
      title: "Disable location services for apps that don't need them (games, utilities)",
      why: "Location data is valuable intelligence. Denying it to non-essential apps reduces your digital footprint."
    },
    {
      id: "d12-dig", level: "dig", difficulty: 2,
      title: "Move downloaded movies or music you won't revisit to external storage, or delete them",
      why: "Media we promise to 'watch later' occupies space without serving joy. Curating keeps the library valuable."
    },
    {
      id: "d13-dig", level: "dig", difficulty: 1,
      title: "Declutter your desktop; create folders or move files to appropriate locations",
      why: "Desktop chaos cascades into mental clutter. A clean workspace improves flow across all digital tasks."
    },
    {
      id: "d14-dig", level: "dig", difficulty: 2,
      title: "Review app permissions; deny camera, mic and location to apps that don't legitimately need them",
      why: "Over-permissioned apps become surveillance vectors. Tight permissions protect privacy without sacrificing functionality."
    },
    {
      id: "d15-dig", level: "dig", difficulty: 1,
      title: "Sort your Downloads folder into proper locations or delete what's obsolete",
      why: "Downloads folders are graveyards for temporary files. Regular purging prevents them from becoming permanent storage."
    },
    {
      id: "d16-dig", level: "dig", difficulty: 3,
      title: "Create a standardized file naming convention (e.g., YYYY-MM-DD_Project_Description) and apply it to recent files",
      why: "Naming chaos makes retrieval impossible. Structure turns archives into searchable libraries, reducing future stress."
    },
    {
      id: "d17-dig", level: "dig", difficulty: 2,
      title: "Review social media accounts you follow; unfollow anyone who drains your energy",
      why: "Your feed is a curated diet. Removing toxic sources protects mental health more efficiently than willpower alone."
    },
    {
      id: "d18-dig", level: "dig", difficulty: 1,
      title: "Set up automatic email filters to archive newsletters and promotions after reading",
      why: "Manual sorting is unsustainable. Automation handles routine cleanup so you can focus on priority messages."
    },
    {
      id: "d19-dig", level: "dig", difficulty: 2,
      title: "Back up important photos and documents to cloud storage or an external drive",
      why: "Digital loss is permanent without redundancy. Protecting memories ensures they survive hardware failures."
    },
    {
      id: "d20-dig", level: "dig", difficulty: 1,
      title: "Create a 'Someday' folder for files you're not ready to delete but don't need now",
      why: "Decision fatigue causes hoarding. Offloading uncertain items preserves space while keeping retrieval options open."
    },
    {
      id: "d21-dig", level: "dig", difficulty: 2,
      title: "Update your operating system and critical apps to the latest versions",
      why: "Outdated software accumulates security vulnerabilities. Updates close doors that malware exploits."
    },
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
      why: "Fragmented storage causes version confusion. Centralizing files ensures you always access the current version."
    },
    {
      id: "d29-dig", level: "dig", difficulty: 1,
      title: "Enable two-factor authentication on your most critical accounts (email, banking)",
      why: "Passwords alone are vulnerable. 2FA adds a second barrier that stops most unauthorized access attempts."
    },
    {
      id: "d30-dig", level: "dig", difficulty: 2,
      title: "Review connected apps in your Google or Apple account; revoke access for services you no longer use",
      why: "OAuth tokens grant permanent access. Revoking unused connections limits what can happen if your credentials are compromised."
    },
	    /* ========== DIGITAL STREAM — DAYS 31–55 ========== */
    {
      id: "d31-dig", level: "dig", difficulty: 2,
      title: "Audit digital subscriptions (streaming, software, apps); cancel those unused for 30+ days",
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
      title: "Set up recurring monthly calendar reminders for bill payments and subscriptions",
      why: "Forgetting due dates incurs fees. Automation handles routine financial tasks reliably."
    },
    {
      id: "d35-dig", level: "dig", difficulty: 2,
      title: "Create a 'digital detox' hour each evening (no screens, e.g. from 7 to 8 PM)",
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
      title: "Enable grayscale mode on your phone for 24 hours; notice the reduced stimulation",
      why: "Color saturates apps with addictive appeal. Grayscale demonstrates how much design manipulates attention."
    },
    {
      id: "d45-dig", level: "dig", difficulty: 2,
      title: "Review your screen time reports; identify which apps drain the most hours",
      why: "Visibility precedes change. Knowing your usage patterns reveals where attention is truly spent."
    },
    {
      id: "d46-dig", level: "dig", difficulty: 1,
      title: "Establish a Sunday 15-minute digital declutter slot (same time weekly)",
      why: "Digital entropy returns without maintenance. A fixed weekly ritual keeps the machine permanently humming."
    },
    {
      id: "d47-dig", level: "dig", difficulty: 2,
      title: "Create a password recovery kit (printed or offline backup of critical recovery codes)",
      why: "Digital minimalism requires trust in your system. Recovery preparedness lets you delete redundancy fearlessly."
    },
    {
      id: "d48-dig", level: "dig", difficulty: 1,
      title: "Pin only your 4 most-used browser tabs; close everything else habitually",
      why: "Tab hoarding fragments attention across dozens of open intentions. Pinned essentials anchor focused work."
    },
    {
      id: "d49-dig", level: "dig", difficulty: 2,
      title: "Set up a 'first hour phone-free' morning rule and prepare an analog alternative",
      why: "Starting the day reactively means living by other people's agendas. Analog mornings reclaim the day's first and freshest thoughts."
    },
    {
      id: "d50-dig", level: "dig", difficulty: 1,
      title: "Delete 50 old photos in one sitting (blurred shots, duplicates, accidental captures)",
      why: "Photo libraries of tens of thousands are unsearchable memories. Pruning makes the kept ones meaningful again."
    },
    {
      id: "d51-dig", level: "dig", difficulty: 2,
      title: "Create a weekly tech review checklist: updates run, backups verified, downloads cleared",
      why: "Scattered digital chores never happen. One checklist, one weekly slot — complete system coverage in minutes."
    },
    {
      id: "d52-dig", level: "dig", difficulty: 1,
      title: "Choose one notification sound for humans only; everything else silent from now on",
      why: "Auditory hierarchy trains instant triage. One sound for people means interruptions become invitations, not alarms."
    },
    {
      id: "d53-dig", level: "dig", difficulty: 2,
      title: "Audit your streaming watchlists; delete everything you'll realistically never watch",
      why: "Watchlists become guilt warehouses. Keeping only genuine desires makes choosing effortless."
    },
    {
      id: "d54-dig", level: "dig", difficulty: 1,
      title: "Review your screen time numbers from Day 45; celebrate any reduction",
      why: "Measurement sustains momentum. Acknowledging progress converts data into fuel."
    },
    {
      id: "d55-dig", level: "dig", difficulty: 2,
      title: "Define your 'digital sunset': a daily time after which screens go dark",
      why: "Boundaries only exist when enforced. A nightly offline horizon protects sleep and gives the day a real ending."
    }
  ],

  el: [
      /* ========== ΦΥΣΙΚΟΣ ΡΟΗ — ΗΜΕΡΕΣ 1–30 ========== */
    {
      id: "d1-phys", level: "phys", difficulty: 1,
      title: "Άδειασε ένα συρτάρι πλήρως",
      why: "Ένας καθαρισμένος χώρος δημιουργεί άμεση ορμή. Αποδεικνύει ότι ο ξεκαθάρισμα είναι εφικτό σε λεπτά, όχι ώρες — και ότι το αίσθημα της ελαφρότητας ξεκινά από τη μικρότερη νίκη."
    },
    {
      id: "d2-phys", level: "phys", difficulty: 2,
      title: "Αφαίρεσε τρία αντικείμενα που δεν έχεις χρησιμοποιήσει έξι μήνες",
      why: "Τα αντικείμενα συσσωρεύονται από αδράνεια, όχι από πρόθεση. Η αφαίρεσή τους σπάει τον αυτόματο πιλότο που αφήνει τα πράγματα να παραμένουν πέρα από τη χρησιμότητά τους."
    },
    {
      id: "d3-phys", level: "phys", difficulty: 1,
      title: "Σκουπίσε μία επιφάνεια (πάγκο κουζίνας, γραφείο, κομοδίνο)",
      why: "Οι καθαρές επιφάνειες προσκαλούν την παρουσία. Όταν το περιβάλλον αντανακλά φροντίδα, το μυαλό ακολουθεί."
    },
    {
      id: "d4-phys", level: "phys", difficulty: 2,
      title: "Δώσε ένα ρούχο που δεν ταιριάζει πια στη ζωή σου",
      why: "Τα ρούχα που κρατάμε «για κάθε περίπτωση» είναι άγκυρες σε αυτόν που ήμασταν. Το να τα αφήσουμε κάνει χώρο για όποιον γινόμαστε."
    },
    {
      id: "d5-phys", level: "phys", difficulty: 1,
      title: "Οργάνωσε ένα ράφι ανά ύψος ή χρώμα (εσύ επιλέγεις)",
      why: "Η οπτική τάξη μειώνει το γνωστικό φορτίο. Ακόμα και μικρές ευθυγραμμίσεις δημιουργούν μια αίσθηση ηρεμίας που απλώνεται προς τα έξω."
    },
    {
      id: "d6-phys", level: "phys", difficulty: 1,
      title: "Μέτρησε πόσα ζευγάρια παπούτσια έχεις",
      why: "Η επίγνωση προηγείται της αλλαγής. Το να ξέρεις απλώς τον αριθμό σου αποκαλύπτει αν έχεις «αρκετά» ή «πολύ» — χωρίς να κρίνεις κάτι ακόμα."
    },
    {
      id: "d7-phys", level: "phys", difficulty: 1,
      title: "Εντόπισε τον έναν χώρο που σε ενοχλεί περισσότερο η αταξία",
      why: "Η ενέργεια είναι πεπερασμένη. Όταν ονομάζεις το κύριο σημείο τριβής, ο μινιμαλισμός σου αποκτά καθαρό πεδίο μάχης — όχι έναν σκορπισμένο πόλεμο."
    },
    {
      id: "d8-phys", level: "phys", difficulty: 2,
      title: "Άδειασε ένα ντουλάπι κουζίνας πλήρως· επέστρεψε μόνο όσα χρησιμοποιείς εβδομαδιαία",
      why: "Φυλάμε φαγητά «για κάθε περίπτωση» και μετά ξεχνάμε ότι υπάρχουν. Το εβδομαδιαίο φίλτρο εκθέτει αντικείμενα που ξεπέρασαν τον σκοπό τους."
    },
    {
      id: "d9-phys", level: "phys", difficulty: 1,
      title: "Πέταξε ό,τι χαλασμένο δεν πρόκειται να φτιάξεις (στυλό, παιχνίδια, ηλεκτρονικά)",
      why: "Τα χαλασμένα αντικείμενα είναι φαντάσματα προθέσεων που δεν πραγματοποιήθηκαν ποτέ. Η αφαίρεσή τους τιμά τον μελλοντικό εαυτό που αξίζει λειτουργικά εργαλεία."
    },
    {
      id: "d10-phys", level: "phys", difficulty: 2,
      title: "Δοκίμασε πέντε ρούχα· δώσε όσα δεν σου κάνουν ή δεν σου πηγαίνουν σήμερα",
      why: "Το να κρατάς ρούχα για το «κάποτε» προδίδει αυτόν που είσαι τώρα. Όταν ντύνεσαι για τον πραγματικό σου εαυτό, χτίζεις καθημερινή αυτοπεποίθηση."
    },
    {
      id: "d11-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε το τραπεζάκι του σαλονιού ή την κύρια επιφάνεια φαγητού εντελώς",
      why: "Οι κοινές επιφάνειες γίνονται χώροι απόρριψης. Ένα καθαρό κέντρο προσκαλεί συζήτηση, φαγητό, παρουσία — όχι στοίβες από ακαταστασία."
    },
    {
      id: "d12-phys", level: "phys", difficulty: 2,
      title: "Πάρε ένα χαρτοκιβώτιο που κάθεται κάπου· γέμισέ το για δωρεά ή δίπλωσέ το για ανακύκλωση",
      why: "Τα κουτιά που περιμένουν να «χρησιμοποιηθούν αργότερα» γίνονται έπιπλα της αναβλητικότητας. Η απόφαση τώρα σπάει τον κύκλο της αόριστης αναβολής."
    },
    {
      id: "d13-phys", level: "phys", difficulty: 1,
      title: "Βγάλε όλα τα παραστατικά από το πορτοφόλι σου",
      why: "Τα παραστατικά λήγουν μόλις τυπωθούν. Το να τα κρατάς πέρα από τα όρια εγγύησης δεν εξυπηρετεί τίποτα — απλώς νοητική σκόνη."
    },
    {
      id: "d14-phys", level: "phys", difficulty: 2,
      title: "Ψάξε τις τσέπες των παλτών σου· βγάλε εισιτήρια, χαρτοπετσέτες, ληγμένες κάρτες δώρου",
      why: "Οι τσέπες είναι μαύρες τρύπες για ξεχασμένο χαρτί. Όταν τις αδειάζεις, μαθαίνεις ότι η «πρόσκαιρη αποθήκευση» σπάνια αποδίδει."
    },
    {
      id: "d15-phys", level: "phys", difficulty: 1,
      title: "Βάλε ένα μπολ στην πόρτα για χαλαρά αντικείμενα (κλειδιά, αλληλογραφία, μικροαγορές)",
      why: "Μια καθορισμένη ζώνη υποδοχής σταματά την εξάπλωση της αταξίας. Μικρή υποδομή κερδίζει το συνεχή συμμάζεμα."
    },
    {
      id: "d16-phys", level: "phys", difficulty: 3,
      title: "Καθάρισε την κορυφή του ψυγείου ή του φούρνου μικροκυμάτων· τίποτα διακοσμητικό πέρα από όσα χρησιμοποιείς καθημερινά",
      why: "Οι κορυφές των συσκευών μαζεύουν αόρατα συντρίμμια δεκαετιών. Ο καθαρισμός τους σε αναγκάζει να αντιμετωπίσεις τη συσσωρευμένη παραμέληση."
    },
    {
      id: "d17-phys", level: "phys", difficulty: 2,
      title: "Εντόπισε δώρα που δεν χρησιμοποιείς ποτέ· αποφάσισε αν τα κρατάς από ευγνωμοσύνη ή τα αφήνεις με σεβασμό",
      why: "Τα δώρα κουβαλούν συναισθηματικό χρέος. Η συνειδητή επιλογή — κράτημα ή απελευθέρωση — μετατρέπει την υποχρέωση σε γνήσια εκτίμηση."
    },
    {
      id: "d18-phys", level: "phys", difficulty: 1,
      title: "Πέταξε αμέσως ληγμένα φάρμακα και καλλυντικά",
      why: "Τα παλιά φάρμακα είναι ρίσκο υγείας· τα παλιά καλλυντικά εκτρέφουν μικρόβια. Η ασφάλεια υπερτερεί της συναισθηματικής αποταμίευσης."
    },
    {
      id: "d19-phys", level: "phys", difficulty: 2,
      title: "Ενοποίησε διπλά εργαλεία (τέσσερα κατσαβίδια σε ένα καλό σετ, δέκα κούπες σε έξι)",
      why: "Η επανάληψη είναι αναποφασιστικότητα ντυμένη προετοιμασία. Η ποιότητα αντί της ποσότητας μειώνει την παράλυση επιλογής."
    },
    {
      id: "d20-phys", level: "phys", difficulty: 1,
      title: "Τράβα μία φωτογραφία από έναν τακτοποιημένο χώρο που δημιούργησες",
      why: "Η τεκμηρίωση των νικών δημιουργεί σημεία αναφοράς. Ο μελλοντικός εαυτός θα ευχαριστήσει τον παλιό που θυμήθηκε πώς μοιάζει η γαλήνη."
    },
    {
      id: "d21-phys", level: "phys", difficulty: 2,
      title: "Αξιολόγησε ένα χόμπι· κράτα υλικά μόνο για ενεργές ασχολίες, δώσε ή ανακύκλωσε τα υπόλοιπα",
      why: "Τα χόμπι που «πρέπει» να κάνουμε αλλά δεν ξεκινάμε ποτέ γίνονται εργοστάσια ενοχής. Η ειλικρίνεια ελευθερώνει πόρους για όσα όντως μας απασχολούν."
    },
    {
      id: "d22-phys", level: "phys", difficulty: 2,
      title: "Άδειασε μια ντουλάπα· κράτα μόνο όσα χωράνε χωρίς να συμπιέζεις κρεμάστρες",
      why: "Οι μεγάλες ντουλάπες κρύβουν την περίσσεια. Ο φυσικός περιορισμός αναγκάζει ειλικρινή αξιολόγηση για το τι ανήκει πραγματικά εκεί."
    },
    {
      id: "d23-phys", level: "phys", difficulty: 1,
      title: "Βγάλε περιοδικά ή καταλόγους παλαιότερους από 6 μήνες· ανακύκλωσέ τα",
      why: "Το έντυπο υλικό λήγει σιωπηλά. Το να κρατάς παλιές εκδόσεις αφοσιώνει τα ράφια χωρίς να εξυπηρετεί τρέχουσες ανάγκες."
    },
    {
      id: "d24-phys", level: "phys", difficulty: 2,
      title: "Εντόπισε αντικείμενα που αγόρασες online αλλά δεν άνοιξες ποτέ· επέστρεψέ τα ή δώσε τα αμέσως",
      why: "Τα ξεκάρφωτα πακέτα είναι μεταμέλεια σε συσκευασία. Η επεξεργασία τους τώρα εμποδίζει τον σωρό να μεγαλώσει."
    },
    {
      id: "d25-phys", level: "phys", difficulty: 1,
      title: "Πλύνε όλα τα σκεπάσματα, πετσέτες και χαλάκια μπάνιου· αντικατέστησε ό,τι λερωμένο ή φθαρμένο",
      why: "Τα φρέσκα υφάσματα ανυψώνουν τη διάθεση. Τα φθαρμένα σηματοδοτούν παραμέληση· η αντικατάστασή τους είναι αυτοσεβασμός."
    },
    {
      id: "d26-phys", level: "phys", difficulty: 2,
      title: "Καθάρισε κάτω από το κρεβάτι σου· τίποτα αποθηκευμένο εκεί εκτός από εποχικά ή σπάνια χρησιμοποιούμενα",
      why: "Ο χώρος κάτω από το κρεβάτι γίνεται νεκροταφείο μισοχρησιμοποιημένων αντικειμένων. Ο περιορισμός της αποθήκευσης αναγκάζει συνειδητές αποφάσεις."
    },
    {
      id: "d27-phys", level: "phys", difficulty: 3,
      title: "Αξιολόγησε μια συναισθηματική συλλογή (αναμνηστικά, ενθύμια)· κράτα μόνο όσα σε συγκινούν πραγματικά",
      why: "Το συναισθηματικό πλεονάζον παραλύει με το «μήπως». Η επιμέλεια διατηρεί το νόημα χωρίς να πνίγεται στη συσσώρευση."
    },
    {
      id: "d28-phys", level: "phys", difficulty: 2,
      title: "Οργάνωσε καλώδια και συνδέσμους· βάλε ετικέτες και φύλαξε τα χαλαρά σε σακούλες ή κουτιά",
      why: "Το χάος των καλωδίων προκαλεί καθημερινή τριβή. Η οργάνωση μετατρέπει το μπερδεμένο ζάλη σε άμεση προσβασιμότητα."
    },
    {
      id: "d29-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε τον πάγκο πάνω από το πλυντήριο ή το στεγνωτήριο· τίποτα να μην μαζεύεται εκεί",
      why: "Οι επιφάνειες πλυντηρίων γίνονται αποθήκη ημιτελών εργασιών. Ένα καθαρό πάνω μέρος ενισχύει την ολοκλήρωση αντί της αναβολής."
    },
    {
      id: "d30-phys", level: "phys", difficulty: 2,
      title: "Αξιολόγησε ένα συρτάρι με διάφορα αντικείμενα· βρες σπίτια ή πέταξε ό,τι δεν έχει θέση",
      why: "Τα συρτάρια-απορριμματοδεξαμενές είναι ζώνες παράδοσης. Το να δώσεις στα αντικείμενα σωστά σπίτια ή να τα αφήσεις αποκαθιστά την τάξη."
    },

    /* ========== ΦΥΣΙΚΟΣ ΡΟΗ — ΗΜΕΡΕΣ 31–55 ========== */
    {
      id: "d31-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε ένα κουτί συνδρομής (kit γευμάτων, καλλυντικά, σνακ)· ακύρωσε αν η χρήση είναι κάτω από 50%",
      why: "Η αδράνεια των συνδρομών σπαταλά χρήματα. Η ακύρωση υποχρησιμοποιημένων υπηρεσιών ανακατευθύνει χρήματα προς ενσυνείδητες αγορές."
    },
    {
      id: "d32-phys", level: "phys", difficulty: 1,
      title: "Βγάλε ληγμένα κουπόνια και διαφημιστικά φυλλάδια από το πορτοφόλι ή το γραφείο σου",
      why: "Οι ληγμένες προσφορές δημιουργούν ψεύτικη ελπίδα. Ο καθαρισμός τους εξαλείφει τον οπτικό θόρυβο και την ψεύτικη επείγουσα ανάγκη."
    },
    {
      id: "d33-phys", level: "phys", difficulty: 2,
      title: "Πούλησε ή δώσε ηλεκτρονικά που αναβάθμισες (παλιά κινητά, tablet, κάμερες)",
      why: "Η τεχνολογία που αντικαθιστούμε πρέπει να χρηματοδοτεί τις αναβαθμίσεις, όχι να μαζεύει σκόνη. Η εκμετάλλευση της απαξίωσης κάνει χώρο για καινοτομία."
    },
    {
      id: "d34-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε το ντουλαπάκι και το πορτ-μπαγκάζ του αυτοκινήτου σου· βγάλε σκουπίδια και ξεχασμένα αντικείμενα",
      why: "Τα οχήματα γίνονται ασυναίσθητα κινητές μονάδες αποθήκευσης. Ο καθαρισμός τους επαναφέρει την εστίαση στην οδήγηση, όχι στην πλοήγηση ανάμεσα σε ακαταστασία."
    },
    {
      id: "d35-phys", level: "phys", difficulty: 2,
      title: "Δώσε παιχνίδια που τα παιδιά ξεπέρασαν· κράτα μόνο τα αγαπημένα και τα κειμήλια",
      why: "Οι κατολισθήσεις παιχνιδιών πνίγουν τους χώρους παιχνιδιού. Η επιμέλεια διατηρεί τη χαρά χωρίς να θάβει τη δημιουργικότητα στην περίσσεια."
    },
    {
      id: "d36-phys", level: "phys", difficulty: 1,
      title: "Άδειασε όλα τα κομοδίνα εντελώς· επέστρεψε μόνο τα απαραίτητα (βιβλίο, ποτήρι νερό, λάμπα)",
      why: "Η αταξία του κομοδίνου διαταράσσει το περιβάλλον ύπνου. Τα ελάχιστα κομοδίνα προάγουν την ξεκούραση και την πρωινή διαύγεια."
    },
    {
      id: "d37-phys", level: "phys", difficulty: 2,
      title: "Ενοποίησε επικαλυπτόμενα προϊόντα καθαρισμού· κράτα μόνο όσα χρησιμοποιείς τακτικά",
      why: "Τα διπλά καθαριστικά σπαταλούν χώρο και χρήματα. Η απλοποίηση μειώνει την κούραση αποφάσεων όταν καθαρίζεις."
    },
    {
      id: "d38-phys", level: "phys", difficulty: 1,
      title: "Ταξινόμησε την εισερχόμενη αλληλογραφία αμέσως· καταστροφοποίησε ό,τι περιττό, αρχειοθέτησε μόνο ό,τι απαιτεί ενέργεια",
      why: "Οι σωροί χαρτιών πολλαπλασιάζονται ταχύτατα. Η διαχείριση κάθε κομματιού μία φορά εμποδίζει τον σχηματισμό εκκρεμοτήτων."
    },
    {
      id: "d39-phys", level: "phys", difficulty: 2,
      title: "Αξιολόγησε τις συσκευές κουζίνας· δώσε όσες αγόρασες αλλά σπάνια χρησιμοποιείς (χυμομηχανή, φοντί)",
      why: "Οι συσκευές μιας χρήσης καταλαμβάνουν το πρώτο οικόπεδο. Το να τις αφήσεις αναγνωρίζει πώς μαγειρεύεις πραγματικά."
    },
    {
      id: "d40-phys", level: "phys", difficulty: 3,
      title: "Κάνε πλήρη έλεγχο αποθηκής τροφίμων· πέταξε ληγμένα, ενοποίησε μισοχρησιμοποιημένα μπαχαρικά",
      why: "Η λήξη τροφίμων περνά απαρατήρητη μέχρι την ώρα απόρριψης. Οι τακτικοί έλεγχοι εξοικονομούν χρήματα και μειώνουν τη σπατάλη."
    },
    {
      id: "d41-phys", level: "phys", difficulty: 2,
      title: "Εντόπισε έπιπλα που αγόρασες παρορμητικά· αποφάσισε αν θα τα προσαρμόσεις, πουλήσεις ή δωρίσεις",
      why: "Τα παρορμητικά έπιπλα κυριαρχούν στα σχέδια δαπέδου. Η ειλικρινής αξιολόγηση αποκαλύπτει τι εξυπηρετεί πραγματικά τον τρόπο ζωής σου."
    },
    {
      id: "d42-phys", level: "phys", difficulty: 1,
      title: "Θεσπίσε τον κανόνα «ένα μέσα, ένα έξω» για τις αγορές ρούχων",
      why: "Η ανεξέλεγκτη απόκτηση εγγυάται υπερπλήρωση. Ο κανόνας της ανταλλαγής διατηρεί την ισορροπία χωρίς περιοριστικούς προϋπολογισμούς."
    },
    {
      id: "d43-phys", level: "phys", difficulty: 2,
      title: "Οργάνωσε το ντουλάπι φαρμάκων σου· ομαδοποίησε ανά μέλος οικογένειας ή σκοπό, πέταξε τα διπλά",
      why: "Τα αποδιοργανωμένα ντουλάπια καθυστερούν σε έκτακτες ανάγκες. Η δομή επιταχύνει την ανάκτηση όταν η επείγουσα ανάγκη χτυπά."
    },
    {
      id: "d44-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε το ψυγείο μέσα και έξω· πέταξε ληγμένα καρυκεύματα και χαλασμένα υπολείμματα",
      why: "Τα βρώμικα ψυγεία μεταδίδουν οσμές και βακτήρια. Ο βαθύς καθαρισμός επαναφέρει τόσο την υγιεινή όσο και την ορατότητα των τροφίμων."
    },
    {
      id: "d45-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε μια κατηγορία συναισθηματικών αντικειμένων (γράμματα, κάρτες, έργα τέχνης παιδιών)· ψηφιοποίησε ή επιμελήσου",
      why: "Οι χάρτινες αναμνήσεις φουσκώνουν απεριόριστα. Η ψηφιοποίηση διατηρεί το νόημα χωρίς να καταλαμβάνει φυσικό χώρο."
    },
    {
      id: "d46-phys", level: "phys", difficulty: 1,
      title: "Θεσπίσε ένα βραδινό τελετουργικό επαναφοράς 10 λεπτών για τον κύριο χώρο διαβίωσής σου",
      why: "Η μικρή καθημερινή συντήρηση αποτρέπει τους μαραθωνίους του Σαββατοκύριακου. Δέκα λεπτά βραδινής επαναφοράς κρατούν την αταξία μόνιμα μακριά."
    },
    {
      id: "d47-phys", level: "phys", difficulty: 2,
      title: "Δημιούργησε σταθμό δωρεών (ένα κουτί ή σακούλα σε σταθερή θέση) για συνεχή απελευθέρωση",
      why: "Χωρίς ορισμένο σημείο εξόδου, τα αντικείμενα προς αποχώρηση μένουν σε αναμονή. Η υποδομή μετατρέπει τις καλές προθέσεις σε ολοκληρωμένες ενέργειες."
    },
    {
      id: "d48-phys", level: "phys", difficulty: 1,
      title: "Ορίσε μόνιμη θέση για κάθε αντικείμενο στην είσοδο (κλειδιά, γυαλιά ηλίου, τσάντες)",
      why: "Το χάος της εισόδου θέτει τον τόνο για όλο το σπίτι. Οι σταθερές θέσεις εξαλείφουν τον καθημερινό κύκλο αναζήτησης-παράτησης."
    },
    {
      id: "d49-phys", level: "phys", difficulty: 2,
      title: "Υιοθέτησε τον κανόνα «το αγγίζω μία φορά» για τα χαρτιά του σπιτιού (αλληλογραφία, έγγραφα, παραστατικά)",
      why: "Το να χειρίζεσαι τα χαρτιά ξανά και ξανά σπαταλά την προσοχή ξανά και ξανά. Η επεξεργασία μίας αφής κρατά τις επιφάνειες μόνιμα καθαρές."
    },
    {
      id: "d50-phys", level: "phys", difficulty: 1,
      title: "Κάνε μια σάρωση 5 αντικειμένων πριν κοιμηθείς: βρες πέντε λάθος τοποθετημένα και επέστρεψε το καθένα στη θέση του",
      why: "Το μικρο-συμμάζεμα συσσωρεύεται. Πέντε αντικείμενα ανά βράδυ ισούνται με 1.825 επανατοποθετήσεις τον χρόνο — η εντροπία ηττάται σιωπηλά."
    },
    {
      id: "d51-phys", level: "phys", difficulty: 2,
      title: "Στήσε μια «βάση εκκίνησης» κοντά στην πόρτα με τα απαραίτητα του αύριο (τσάντα, πορτοφόλι, φορτιστές)",
      why: "Οι πρωινές αποφάσεις εξαντλούν τη θέληση. Όταν προετοιμάζεις απόψε, ξεκινάς το αύριο ήδη σε κίνηση."
    },
    {
      id: "d52-phys", level: "phys", difficulty: 1,
      title: "Καθόρισε ένα «συρτάρι των πάντων» — και δέξου ότι υπάρχει",
      why: "Η τελειομανία σκοτώνει τον μινιμαλισμό. Μία αδειοδοτημένη ζώνη χάους αποτρέπει την ενοχή ενώ κρατά τον υπόλοιπο χώρο ενσυνείδητο."
    },
    {
      id: "d53-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε την αποθήκευση των προϊόντων καθαρισμού· κράτα μόνο ένα από κάθε τύπο προϊόντος",
      why: "Πολλά μισογεμάτα μπουκάλια δημιουργούν αταξία και σύγχυση. Η ενοποίηση κάνει τη συντήρηση προβλέψιμη."
    },
    {
      id: "d54-phys", level: "phys", difficulty: 1,
      title: "Φωτογράφισε μία περιοχή «πριν» από την Εβδομάδα 1· σύγκρινέ τη με το σήμερα",
      why: "Η πρόοδος είναι αόρατη μέρα με τη μέρα. Τα τεκμήρια διατηρούν το κίνητρο όταν το ταξίδι φαίνεται στάσιμο."
    },
    {
      id: "d55-phys", level: "phys", difficulty: 2,
      title: "Γράψε τον προσωπικό σου ορισμό του «αρκούν»: πόσα πιάτα, πετσέτες, πουκάμισα είναι το ΔΙΚΟ ΣΟΥ αρκετά",
      why: "Χωρίς άνω όριο, η συσσώρευση είναι άπειρη. Ο ορισμός του «αρκούν» είναι η φιλοσοφική βάση κάθε μελλοντικής απόφασης."
    },
	    /* ========== ΨΗΦΙΑΚΟΣ ΡΟΗ — ΗΜΕΡΕΣ 1–30 ========== */
    {
      id: "d1-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε 10 μη χρησιμοποιούμενες εφαρμογές από το κινητό σου",
      why: "Κάθε εφαρμογή που δεν χρησιμοποιείς είναι θόρυβος — ειδοποιήσεις, εικονίδια, νοητική αταξία. Η αφαίρεσή τους συρρικνώνει την επιφάνεια προσοχής σου."
    },
    {
      id: "d2-dig", level: "dig", difficulty: 2,
      title: "Κλείσε όλες τις μη ανθρώπινες ειδοποιήσεις (εφαρμογές, νέα, προωθήσεις)",
      why: "Αν δεν είναι από άνθρωπο, μπορεί να περιμένει. Προστατεύοντας την προσοχή σου από τον θόρυβο των broadcast επαναφέρεις την εξουσία στο πότε δίνεις συγκέντρωση."
    },
    {
      id: "d3-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε τη μπάρα σελιδοδεικτών του browser σε λιγότερα από 7 αντικείμενα",
      why: "Ένας γεμάτος μπάρα σελιδοδεικτών σε εκπαιδεύει να scrollάρεις αντί να αναζητάς. Ένας σπάνιος σε αναγκάζει σε συνειδητή επιλογή — και συχνά αποκαλύπτει ότι δεν χρειάζεσαι το μισό από αυτό."
    },
    {
      id: "d4-dig", level: "dig", difficulty: 2,
      title: "Απόγραψε από 5 λίστες email προώθησης",
      why: "Τα marketing emails απαγάγουν το inbox σου και εκπαιδεύουν την επείγουσα κατάσταση όπου δεν υπάρχει. Κάθε απόγραωση ανακτά ένα κομμάτι της νοητικής σου ευρυχωρίας."
    },
    {
      id: "d5-dig", level: "dig", difficulty: 1,
      title: "Αρχειοθέτησε όλα τα email старше από 90 ημέρες από το inbox",
      why: "Ένα άδειο inbox δεν αφορά την παραγωγικότητα — αφορά το να καθαρίσεις τον οπτικό θόρυβο που κάνει τα σημαντικά μηνύματα πιο δύσκολα βρέσιμα."
    },
    {
      id: "d6-dig", level: "dig", difficulty: 1,
      title: "Απόγραψε από ένα ενημερωτικό δελτίο καταστημάτων",
      why: "Τα εμπορικά email κατασκευάζουν επιθυμία εκεί που δεν υπάρχει. Ένα λιγότερο δελτίο σημαίνει λιγότερες κατασκευασμένες επείγουσες ανάγκες."
    },
    {
      id: "d7-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε στιγμιότυπα οθόνης που πήρες μήνες πριν και δεν κοίταξες ποτέ",
      why: "Τα στιγμιότυπα οθόνης είναι ψηφιακά μπαούλα. Κρατούν στιγμές χωρίς πλαίσιο και μαζεύουν pixels χωρίς σκοπό."
    },
    {
      id: "d8-dig", level: "dig", difficulty: 2,
      title: "Αποσυνδέσου από ιστοσελίδες που δεν επισκέφθηκες 6+ μήνες· ανέκλησε την πρόσβασή τους όπου γίνεται",
      why: "Οι συνεδρίες σύνδεσης είναι ψηφιακές προσκλήσεις για καταγραφή δεδομένων. Η ανάκληση σφίγγει την περίμετρο ασφαλείας σου."
    },
    {
      id: "d9-dig", level: "dig", difficulty: 1,
      title: "Κλείσε τις ενδείξεις ανάγνωσης στις εφαρμογές μηνυμάτων αν σε αγχώνουν",
      why: "Οι ενδείξεις ανάγνωσης δημιουργούν αόρατες υποχρεώσεις. Η προσοχή σου σου ανήκει — όχι στις προσδοκίες των άλλων."
    },
    {
      id: "d10-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε τον διαχειριστή κωδικών σου· ένωσε διπλούς λογαριασμούς, διέγραψε παλιές εγγραφές σύνδεσης",
      why: "Οι διπλοί κωδικοί πολλαπλασιάζουν τις επιφάνειες παραβίασης. Ο καθαρός θησαυρός κωδικών προστατεύει την πρόσβαση χωρίς να πολλαπλασιάζει το ρίσκο."
    },
    {
      id: "d11-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τις υπηρεσίες τοποθεσίας για εφαρμογές που δεν τις χρειάζονται (παιχνίδια, εργαλεία)",
      why: "Τα δεδομένα τοποθεσίας είναι πολύτιμη πληροφορία. Η άρνησή τους σε μη απαραίτητες εφαρμογές μειώνει το ψηφιακό σου αποτύπωμα."
    },
    {
      id: "d12-dig", level: "dig", difficulty: 2,
      title: "Μετακίνησε ταινίες ή μουσική που κατέβασες και δεν θα ξαναδείς σε εξωτερική αποθήκευση, ή διέγραψέ τις",
      why: "Τα μέσα που υποσχόμαστε να «δούμε αργότερα» καταλαμβάνουν χώρο χωρίς να προσφέρουν χαρά. Η επιμέλεια κρατά τη βιβλιοθήκη πολύτιμη."
    },
    {
      id: "d13-dig", level: "dig", difficulty: 1,
      title: "Τακτοποίησε την επιφάνεια εργασίας σου· δημιούργησε φακέλους ή μετακίνησε αρχεία στις σωστές θέσεις",
      why: "Το χάος της επιφάνειας μετατρέπεται σε νοητική αταξία. Ένας καθαρός χώρος εργασίας βελτιώνει τη ροή σε κάθε ψηφιακή εργασία."
    },
    {
      id: "d14-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε τα δικαιώματα των εφαρμογών· αρνήσου κάμερα, μικρόφωνο και τοποθεσία σε όσες δεν τα χρειάζονται πραγματικά",
      why: "Οι υπερ-δικαιωματικές εφαρμογές γίνονται μοχλοί παρακολούθησης. Τα σφιχτά δικαιώματα προστατεύουν την ιδιωτικότητα χωρίς θυσία λειτουργικότητας."
    },
    {
      id: "d15-dig", level: "dig", difficulty: 1,
      title: "Ταξινόμησε τον φάκελο Λήψεις σε σωστές θέσεις ή διέγραψε ό,τι παρωχημένο",
      why: "Οι φάκελοι λήψεων είναι νεκροταφεία προσωρινών αρχείων. Το τακτικό κλάδεμα τους εμποδίζει να γίνουν μόνιμη αποθήκη."
    },
    {
      id: "d16-dig", level: "dig", difficulty: 3,
      title: "Δημιούργησε ενιαία σύμβαση ονομασίας αρχείων (π.χ. ΧΧΧΧ-ΧΧ-ΧΧ_Έργο_Περιγραφή) και εφάρμοσέ τη στα πρόσφατα",
      why: "Το χαοτικό όνομα κάνει την ανάκτηση αδύνατη. Η δομή μετατρέπει τα αρχεία σε αναζητήσιμη βιβλιοθήκη, μειώνοντας μελλοντικό άγχος."
    },
    {
      id: "d17-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε τους λογαριασμούς που ακολουθείς στα social media· άραξε όποιον σου αφαιρεί ενέργεια",
      why: "Η ροή σου είναι επιμελημένη διατροφή. Η αφαίρεση τοξικών πηγών προστατεύει την ψυχική υγεία πιο αποτελεσματικά από τη θέληση."
    },
    {
      id: "d18-dig", level: "dig", difficulty: 1,
      title: "Στήσε αυτόματα φίλτρα email που αρχειοθετούν ενημερωτικά δελτία μετά την ανάγνωση",
      why: "Η χειροκίνητη ταξινόμηση δεν βγαίνει σε βάθος χρόνου. Ο αυτοματισμός αναλαμβάνει τη ρουτίνα ώστε να εστιάζεις στα σημαντικά."
    },
    {
      id: "d19-dig", level: "dig", difficulty: 2,
      title: "Κάνε backup σημαντικών φωτογραφιών και εγγράφων σε cloud ή εξωτερικό δίσκο",
      why: "Η ψηφιακή απώλεια είναι οριστική χωρίς εναλλακτικά αντίγραφα. Η προστασία των αναμνήσεων τις κρατά ζωντανές μετά από βλάβες."
    },
    {
      id: "d20-dig", level: "dig", difficulty: 1,
      title: "Δημιούργησε φάκελο «Κάποτε» για αρχεία που δεν είσαι έτοιμος να διαγράψεις αλλά δεν χρειάζεσαι τώρα",
      why: "Η κούραση από αποφάσεις προκαλεί συσσώρευση. Η μεταφορά των αβέβαιων κρατά χώρο ελεύθερο με ανοιχτή την επιλογή ανάκτησης."
    },
    {
      id: "d21-dig", level: "dig", difficulty: 2,
      title: "Ενημέρωσε το λειτουργικό σύστημα και τις κρίσιμες εφαρμογές στις τελευταίες εκδόσεις",
      why: "Το παρωχημένο λογισμικό συσσωρεύει τρύπες ασφαλείας. Οι ενημερώσεις κλείνουν πόρτες που εκμεταλλεύεται το κακόβουλο λογισμικό."
    },
    {
      id: "d22-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε τις επεκτάσεις browser· απενεργοποίησε ή διέγραψε όσες δεν χρησιμοποιήθηκαν 3+ μήνες",
      why: "Οι επεκτάσεις καταναλώνουν μνήμη και παρακολουθούν δραστηριότητα. Ο κλαδεμός μειώνει την επιφάνεια επίθεσης και βελτιώνει την απόδοση."
    },
    {
      id: "d23-dig", level: "dig", difficulty: 1,
      title: "Άδειασε το ιστορικό clipboard (τα περισσότερα συστήματα αποθηκεύουν αυτόματα πρόσφατες αντιγραφές)",
      why: "Το ιστορικό clipboard διαρρέει ευαίσθητα δεδομένα. Το άδειασμα εμποδίζει την τυχαία αποκάλυψη αντιγραφμένων πληροφοριών."
    },
    {
      id: "d24-dig", level: "dig", difficulty: 2,
      title: "Απενεργοποίησε παλιούς λογαριασμούς social media που δεν χρησιμοποιείς· διαγραφή μόνιμα μετά από 30 ημέρες",
      why: "Τα εγκαταλελειμμένα λογαριασμοί είναι θραύσματα ταυτότητας. Το κλείσιμο τους μειώνει το ψηφιακό σου αποτύπωμα και την ευπάθεια."
    },
    {
      id: "d25-dig", level: "dig", difficulty: 1,
      title: "Κλείσε την αυτόματη αναπαραγωγή βίντεο σε social media και ειδήσεις",
      why: "Η αυτόματη αναπαραγωγή απαγάγει τα χρονικά διαστήματα προσοχής. Η απενεργοποίηση απαιτεί συνειδητή επιλογή για να συνεχίσεις."
    },
    {
      id: "d26-dig", level: "dig", difficulty: 2,
      title: "Διέγραψε δεδομένα autofill browser για sites όπου ψωνίζεις σπάνια",
      why: "Αποθηκευμένες πληροφορίες πληρωμών ενθαρρύνουν τις παρορμητικές αγορές. Η αφαίρεση εισάγει τριβή που προωθεί τη στοχαστική δαπάνη."
    },
    {
      id: "d27-dig", level: "dig", difficulty: 3,
      title: "Δημιούργησε ξεχωριστά προφίλ χρήστη στον υπολογιστή για εργασία vs προσωπική χρήση",
      why: "Τα θολά όρια διαρρέουν διασπάσεις. Η διαχωριστική προφίλ δημιουργεί νοητικά όρια και μειώνει το switching context."
    },
    {
      id: "d28-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε και ενοποίησε διπλούς φακέλους cloud storage σε Google Drive, Dropbox κλπ.",
      why: "Η κατακερματισμένη αποθήκευση προκαλεί σύγχυση εκδόσεων. Η συγκέντρωση αρχείων εξασφαλίζει ότι όλοι προσπελάζουν την τρέχουσα έκδοση."
    },
    {
      id: "d29-dig", level: "dig", difficulty: 1,
      title: "Ενεργοποίησε διπλή ταυτοποίηση (2FA) στους πιο κρίσιμους λογαριασμούς (email, τράπεζες)",
      why: "Οι κωδικοί μόνοι τους είναι ευάλωτοι. Το 2FA προσθέτει δεύτερο φράγμα που σταματά τις περισσότερες προσπάθειες μη εξουσιοδοτημένης πρόσβασης."
    },
    {
      id: "d30-dig", level: "dig", difficulty: 2,
      title: "Έλεγχε τις συνδεδεμένες εφαρμογές στον λογαριασμό Google ή Apple σου· ανέκλησε πρόσβαση για υπηρεσίες που δεν χρησιμοποιείς",
      why: "Οι tokens OAuth χορηγούν μόνιμη πρόσβαση. Η ανάκληση μη χρησιμοποιούμενων συνδέσεων περιορίζει τι μπορεί να συμβεί αν τα διαπιστευτήριά σου παραβιαστούν."
    },

    /* ========== ΨΗΦΙΑΚΟΣ ΡΟΗ — ΗΜΕΡΕΣ 31–55 ========== */
    {
      id: "d31-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε ψηφιακές συνδρομές (streaming, λογισμικό, εφαρμογές)· ακύρωσε όσες δεν χρησιμοποιήθηκαν 30+ ημέρες",
      why: "Οι επαναλαμβανόμενες χρεώσεις συσσωρεύονται αόρατα. Η ακύρωση επιστρέφει χρήματα στον έλεγχό σου και προσοχή στην επιλογή σου."
    },
    {
      id: "d32-dig", level: "dig", difficulty: 1,
      title: "Απόγραψε από δύο ακόμα newsletters αγορών ή προσφορών",
      why: "Κάθε email λιανικής φυτεύει σπόρους επιθυμίας. Η μείωση του όγκου μειώνει τον πειρασμό χωρίς προσπάθεια."
    },
    {
      id: "d33-dig", level: "dig", difficulty: 2,
      title: "Έλεγχε τις ρυθμίσεις ειδοποιήσεων για όλες τις εφαρμογές· κλείσε όλα τα μη κρίσιμα",
      why: "Οι περισσότερες ειδοποιήσεις απαιτούν προσοχή χωρίς να παρέχουν αξία. Η σιωπή δίνει τον έλεγχο πίσω στο πρόγραμμά σου."
    },
    {
      id: "d34-dig", level: "dig", difficulty: 1,
      title: "Στήσε επαναλαμβανόμενα μηνιαία ημερολόγια για πληρωμές λογαριασμών και συνδρομών",
      why: "Το να ξεχνάς τις ημερομηνίες λήξης προκαλεί πρόστιμα. Ο αυτοματισμός χειρίζεται ρουτίνας οικονομικές εργασίες αξιόπιστα."
    },
    {
      id: "d35-dig", level: "dig", difficulty: 2,
      title: "Δημιούργησε μία ώρα «ψηφιακής αποτοξίνωσης» κάθε βράδυ (όχι οθόνες, π.χ. 7–8μμ)",
      why: "Η συνεχής συνδεσιμότητα διαβρώνει την παρουσία. Ο προγραμματισμένος αποσυνδέων χτίζει ξανά τα χρονικά διαστήματα προσοχής και την ποιότητα ύπνου."
    },
    {
      id: "d36-dig", level: "dig", difficulty: 1,
      title: "Οργάνωσε την κύρια οθόνη του κινητού σου· κράτα ορατές μόνο τις καθημερινές βασικές εφαρμογές",
      why: "Οι ορατές εφαρμογές ενεργοποιούν ελεγχόμενες ελέγχους. Η επιμέλεια της πρώτης οθόνης διαμορφώνει τη ψηφιακή συμπεριφορά."
    },
    {
      id: "d37-dig", level: "dig", difficulty: 2,
      title: "Στήσε αυτόματη επισήμανση email ή ταξινόμηση για συχνούς αποστολείς (τράπεζα, ιατρική, εργασία)",
      why: "Η χειροκίνητη ταξινόμηση εξαντλεί την ενέργεια καθημερινά. Οι κανόνες αυτοματισμού χειρίζονται την ταξινόμηση ρουτίνας αμέσως."
    },
    {
      id: "d38-dig", level: "dig", difficulty: 3,
      title: "Εφαρμόσε πολιτική «μηδενικού inbox» για όλα τα κανάλια επικοινωνίας (Slack, Teams, email)",
      why: "Οι μη επεξεργασμένες μηνύματα πολλαπλασιάζονται σε συντριπτικό θόρυβο. Το inbox zero δημιουργεί νοητική διαύγεια μέσω συστηματικής δράσης."
    },
    {
      id: "d39-dig", level: "dig", difficulty: 2,
      title: "Έλεγχε τις συσκευές συνδεδεμένες στο Wi-Fi σου· αποσύνδεσε IoT gadgets που δεν χρησιμοποιείς πια",
      why: "Κάθε συνδεδεμένη συσκευή είναι δυνητικό σημείο επίθεσης. Το ξεβίδωμα μειώνει σημαντικά την επιφάνεια επίθεσής σου."
    },
    {
      id: "d40-dig", level: "dig", difficulty: 1,
      title: "Δημιούργησε συντόμευση desktop για τις 5 πιο χρησιμοποιούμενες εφαρμογές μόνο",
      why: "Πολλές συντομεύσεις σκορπίζουν την εστίαση. Ο περιορισμός σημείων πρόσβασης μειώνει την παράλυση αποφάσεων κατά τη διάρκεια της εργασίας."
    },
    {
      id: "d41-dig", level: "dig", difficulty: 2,
      title: "Έλεγχε τις εκκρεμότητες πιστωτικής κάρτας για διπλές ή ξεχασμένες χρεώσεις",
      why: "Τα σφάλματα χρέωσης και απάτες κρύβονται στην ορατότητα. Ο μηνιαίος έλεγχος πιάνει προβλήματα πριν αναπτυχθούν."
    },
    {
      id: "d42-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε διαχειριστή κωδικών για να δημιουργήσεις μοναδικούς κωδικούς για όλους τους νέους λογαριασμούς",
      why: "Η επαναχρησιμοποίηση κωδικών είναι καταστροφική σε παραβιάσεις. Μοναδικά διαπιστευτήρια περιέχουν ζημιά σε μονά λογαριασμούς."
    },
    {
      id: "d43-dig", level: "dig", difficulty: 2,
      title: "Ρύθμισε υπογραφές email με ελάχιστες, επαγγελματικές πληροφορίες μόνο",
      why: "Η υπερ-αποκάλυψη προσωπικών λεπτομερειών καλεί ανεπιθύμητη επαφή. Η επαγγελματική συνοχή διατηρεί τα όρια αποτελεσματικά."
    },
    {
      id: "d44-dig", level: "dig", difficulty: 1,
      title: "Ενεργοποίησε την λειτουργία ασπρόμαυρου στο κινητό σου για 24 ώρες· παρατήρησε τη μείωση διέγερσης",
      why: "Το χρώμα κορεσμούς τις εφαρμογές με εθιστική έλξη. Το ασπρόμαυρο δείχνει πόσο πολύ ο σχεδιασμός χειραγωγεί την προσοχή."
    },
    {
      id: "d45-dig", level: "dig", difficulty: 2,
      title: "Έλεγχε τις αναφορές screen time σου· εντόπισε ποιες εφαρμογές αφαιρούν τις περισσότερες ώρες",
      why: "Η ορατότητα προηγείται της αλλαγής. Γνωρίζοντας τα μοτίβα χρήσης σου αποκαλύπτει πού ξοδεύεται πραγματικά η προσοχή."
    },
    {
      id: "d46-dig", level: "dig", difficulty: 1,
      title: "Θεσπίσε μια Κυριακάτικη θέση 15 λεπτών για ψηφιακό συμμάζεμα (ίδια ώρα κάθε εβδομάδα)",
      why: "Η ψηφιακή εντροπία επιστρέφει χωρίς συντήρηση. Ένα σταθερό εβδομαδιαίο τελετουργικό κρατά τη μηχανή μόνιμα σε τάξη."
    },
    {
      id: "d47-dig", level: "dig", difficulty: 2,
      title: "Δημιούργησε κιτ ανάκτησης κωδικών (τυπωμένο ή offline αντίγραφο των κρίσιμων κωδικών ανάκτησης)",
      why: "Ο ψηφιακός μινιμαλισμός απαιτεί εμπιστοσύνη στο σύστημά σου. Η προετοιμασία ανάκτησης σε αφήνει να διαγράφεις πλεονάσματα χωρίς φόβο."
    },
    {
      id: "d48-dig", level: "dig", difficulty: 1,
      title: "Κάρφωσε μόνο τις 4 πιο χρησιμοποιούμενες καρτέλες του browser· κλείσε όλα τα υπόλοιπα συνήθως",
      why: "Η συσσώρευση καρτελών θραύει την προσοχή σε δεκάδες ανοιχτές προθέσεις. Οι καρφωμένες βασικές αγκυρώνουν τη συγκεντρωμένη εργασία."
    },
    {
      id: "d49-dig", level: "dig", difficulty: 2,
      title: "Θεσπίσε κανόνα «πρώτη ώρα χωρίς κινητό» και ετοίμασε μια αναλογική εναλλακτική",
      why: "Όταν ξεκινάς τη μέρα αντιδραστικά, ζεις με το πρόγραμμα των άλλων. Τα αναλογικά πρωινά ξανακερδίζουν τις πρώτες και πιο φρέσκες σκέψεις της μέρας."
    },
    {
      id: "d50-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε 50 παλιές φωτογραφίες σε μία συνεδρία (θολές, διπλές, τυχαίες λήψεις)",
      why: "Βιβλιοθήκες φωτογραφιών δεκάδων χιλιάδων είναι μη αναζητήσιμες αναμνήσεις. Το κλάδεμα κάνει τις κρατημένες ξανά ουσιαστικές."
    },
    {
      id: "d51-dig", level: "dig", difficulty: 2,
      title: "Δημιούργησε εβδομαδιαία λίστα ελέγχου τεχνολογίας: ενημερώσεις έγιναν, backups επαληθεύτηκαν, λήψεις καθάρισαν",
      why: "Τα σκορπισμένα ψηφιακά θελήματα δεν γίνονται ποτέ. Μία λίστα, ένα εβδομαδιαίο slot — πλήρης κάλυψη συστήματος σε λεπτά."
    },
    {
      id: "d52-dig", level: "dig", difficulty: 1,
      title: "Διάλεξε έναν ήχο ειδοποίησης μόνο για ανθρώπους· όλα τα υπόλοιπα σιωπηλά από εδώ και στο εξής",
      why: "Η ακουστική ιεράρχηση εκπαιδεύει άμεση διαλογή. Ένας ήχος για ανθρώπους σημαίνει ότι οι διακοπές γίνονται προσκλήσεις, όχι συναγερμοί."
    },
    {
      id: "d53-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε τις λίστες προβολής streaming· διέγραψε ό,τι ρεαλιστικά δεν θα δεις ποτέ",
      why: "Οι λίστες προβολής γίνονται αποθήκες ενοχής. Κρατώντας μόνο γνήσιες επιθυμίες, η επιλογή γίνεται αβίαστη."
    },
    {
      id: "d54-dig", level: "dig", difficulty: 1,
      title: "Ξαναδές τους αριθμούς χρόνου οθόνης από την Ημέρα 45· γιόρτασε κάθε μείωση",
      why: "Η μέτρηση διατηρεί την ορμή. Η αναγνώριση της προόδου μετατρέπει τα δεδομένα σε καύσιμη ύλη."
    },
    {
      id: "d55-dig", level: "dig", difficulty: 2,
      title: "Όρισε το «ψηφιακό σου ηλιοβασίλεμα»: μία καθημερινή ώρα μετά την οποία οι οθόνες σβήνουν",
      why: "Τα όρια υπάρχουν μόνο όταν επιβάλλονται. Ένα νυχτερινό offline όριο προστατεύει τον ύπνο και δίνει στη μέρα ένα αληθινό τέλος."
    }
  ]
};