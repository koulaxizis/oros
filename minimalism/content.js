// ============================================================
// orOS Minimalism — Content (Bilingual)
// Deterministic ordering: Day N = floor((dayOfYear % 365)) + 1
// 365 entries per level, difficulty-balanced (no two hard in a row)
// Versioned via ?v= stamp in index.html — no internal version num.
// Current coverage: Days 1–365 (both levels, EN+EL).
// Monthly themes follow the calendar (Day 1 ≈ 1 January);
// capsule-wardrobe resets on ~1 Jan / 1 Apr / 1 Jul / 1 Oct.
// Shorter arrays wrap via modulo — partial coverage never crashes.
// ============================================================

window.MINIMALISM_CONTENT = {
  en: [
    /* ===== PHYSICAL — DAYS 1–31 · JANUARY · Fresh start ===== */
    {
      id: "d1-phys", level: "phys", difficulty: 1,
      title: "Clear one drawer completely",
      why: "One fully cleared space proves decluttering takes minutes, not weekends. Small, finished wins build the momentum for everything that follows."
    },
    {
      id: "d2-phys", level: "phys", difficulty: 1,
      title: "Create one landing spot by the door for keys, wallet and mail",
      why: "A fixed home for daily essentials stops clutter from spreading through the house and ends the morning hunt for keys."
    },
    {
      id: "d3-phys", level: "phys", difficulty: 2,
      title: "Clear the kitchen counter of everything you don't use daily",
      why: "Counters are work surfaces, not storage. Clear space makes cooking easier and cleaning faster."
    },
    {
      id: "d4-phys", level: "phys", difficulty: 1,
      title: "Empty your wallet: old receipts, expired cards, loyalty cards you never use",
      why: "A slim wallet is faster to use and easier to keep track of. Keep only receipts you may need for returns or warranties."
    },
    {
      id: "d5-phys", level: "phys", difficulty: 1,
      title: "Gather expired medicines and ask your local pharmacy whether it collects them",
      why: "Old medicines should never go down the toilet or into household trash, because they end up in water and soil. Keep them in a bag until you find a proper collection point."
    },
    {
      id: "d6-phys", level: "phys", difficulty: 1,
      title: "Walk through your home and name the one spot that stresses you most",
      why: "Energy is limited. Knowing your biggest friction point gives the year a clear first target instead of scattered effort."
    },
    {
      id: "d7-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: spend 10 minutes putting things back where they belong",
      why: "Most clutter is not excess, just items out of place. A short weekly reset keeps small messes from becoming big projects."
    },
    {
      id: "d8-phys", level: "phys", difficulty: 1,
      title: "Clear the top of the fridge and other appliances",
      why: "Appliance tops quietly collect dust and forgotten items. Clearing them removes visual noise from the room you use most."
    },
    {
      id: "d9-phys", level: "phys", difficulty: 2,
      title: "Let go of broken items you honestly won't repair",
      why: "A broken object you keep 'to fix someday' is a small daily reminder of an unfinished task. Repair it this week or release it."
    },
    {
      id: "d10-phys", level: "phys", difficulty: 2,
      title: "Sort the mail pile into three groups: act, file, recycle",
      why: "Paper piles grow because every sheet hides an undecided action. Deciding once, in one sitting, clears both the table and your mind."
    },
    {
      id: "d11-phys", level: "phys", difficulty: 1,
      title: "Clear your coffee table or dining table completely",
      why: "Shared surfaces become dumping grounds. A clear table invites meals, conversation and rest instead of piles."
    },
    {
      id: "d12-phys", level: "phys", difficulty: 2,
      title: "Reduce mugs and glasses to the number you actually use",
      why: "Most cupboards hold far more cups than a household uses between two dishwasher runs. Keep the favorites, donate the rest."
    },
    {
      id: "d13-phys", level: "phys", difficulty: 1,
      title: "Empty the pockets of your coats and bags",
      why: "Pockets are hiding places for tickets, tissues and receipts. Emptying them takes five minutes and often turns up something useful."
    },
    {
      id: "d14-phys", level: "phys", difficulty: 1,
      title: "Write one sentence: what would 'enough' look like in your home?",
      why: "Minimalism is not about owning as little as possible, but about owning what serves you. A clear definition makes every future decision easier."
    },
    {
      id: "d15-phys", level: "phys", difficulty: 2,
      title: "Go through the bathroom cabinet: expired cosmetics, sunscreen and samples",
      why: "Cosmetics have a shelf life after opening, often marked by a small open-jar symbol. Expired products can irritate skin and just take up space."
    },
    {
      id: "d16-phys", level: "phys", difficulty: 3,
      title: "Fill one bag for donation from anywhere in the house and drop it off today",
      why: "A donation bag that sits in the hallway for weeks is just clutter that moved. Taking it out the same day closes the loop."
    },
    {
      id: "d17-phys", level: "phys", difficulty: 1,
      title: "Clear out the fridge: expired sauces, old leftovers, forgotten jars",
      why: "A tidy fridge shows you what you have, so you waste less food and buy fewer duplicates."
    },
    {
      id: "d18-phys", level: "phys", difficulty: 2,
      title: "Tackle the junk drawer: keep only items with a clear job",
      why: "Every home has one drawer where undecided things go. Giving each item a purpose, or a goodbye, turns it into a useful tool drawer."
    },
    {
      id: "d19-phys", level: "phys", difficulty: 2,
      title: "Consolidate duplicates: scissors, tape measures, screwdrivers, staplers",
      why: "Duplicates feel like preparedness but usually mean you couldn't find the first one. One good item in a known place beats three scattered ones."
    },
    {
      id: "d20-phys", level: "phys", difficulty: 1,
      title: "Clear your nightstand: keep only what you use at night",
      why: "The last surface you see before sleep shapes how you wind down. A calm nightstand supports calm evenings."
    },
    {
      id: "d21-phys", level: "phys", difficulty: 1,
      title: "Take a photo of a space you've cleared this month",
      why: "Before-and-after reminders keep motivation alive on the days progress feels invisible."
    },
    {
      id: "d22-phys", level: "phys", difficulty: 1,
      title: "Keep a reasonable number of reusable shopping bags; donate the rest",
      why: "Reusable bags only help the environment when they're reused. A stash of fifty defeats the point."
    },
    {
      id: "d23-phys", level: "phys", difficulty: 2,
      title: "Match food containers with lids; recycle the orphans",
      why: "Mismatched containers make every leftover a small puzzle. A complete, stackable set saves time and space."
    },
    {
      id: "d24-phys", level: "phys", difficulty: 1,
      title: "Adopt the one-in, one-out rule for the next month",
      why: "When every new item replaces an old one, your home stops growing without you noticing."
    },
    {
      id: "d25-phys", level: "phys", difficulty: 1,
      title: "Keep only the shoes you wear this week at the entrance",
      why: "Piles of shoes by the door make every entrance feel crowded. Store the rest where they belong."
    },
    {
      id: "d26-phys", level: "phys", difficulty: 1,
      title: "Recycle user manuals for things you no longer own; most are online anyway",
      why: "Manuals pile up quietly. Keep only warranty documents and manuals you can't find online."
    },
    {
      id: "d27-phys", level: "phys", difficulty: 2,
      title: "Clear out your car, bike basket or everyday bag",
      why: "The space you travel in is part of your home. Arriving somewhere from a clean car or bag changes how the day starts."
    },
    {
      id: "d28-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: return every item in one room to its place",
      why: "Repeating the same small routine every week turns tidying from a project into a habit."
    },
    {
      id: "d29-phys", level: "phys", difficulty: 1,
      title: "Recycle old magazines, flyers and catalogs",
      why: "Printed material goes out of date quickly. What you truly want to reread you can usually find again online."
    },
    {
      id: "d30-phys", level: "phys", difficulty: 1,
      title: "Test every pen and marker; keep only the ones that work",
      why: "Reaching for a dead pen is a tiny daily frustration. A small cup of reliable pens is all most homes need."
    },
    {
      id: "d31-phys", level: "phys", difficulty: 1,
      title: "January review: list three things that left your home and how it feels",
      why: "Noticing results reinforces the habit. The feeling of lightness is the real reward, and naming it makes it last."
    },
    /* ===== PHYSICAL — DAYS 32–59 · FEBRUARY · Wardrobe & bedroom ===== */
    {
      id: "d32-phys", level: "phys", difficulty: 2,
      title: "Count every piece of clothing you own and write the number down",
      why: "A wardrobe census takes about half an hour and the total is often far higher than people expect. It becomes your honest starting point."
    },
    {
      id: "d33-phys", level: "phys", difficulty: 3,
      title: "Pull out every item you haven't worn in a year and decide on each one",
      why: "A full year of seasons has passed without it. Unless there's a clear reason to keep it, someone else could be wearing it now."
    },
    {
      id: "d34-phys", level: "phys", difficulty: 1,
      title: "Turn all your hangers backwards; flip each one after you wear the item",
      why: "In a few months the hangers will show you, without guesswork, what you actually wear."
    },
    {
      id: "d35-phys", level: "phys", difficulty: 1,
      title: "Sort socks and underwear: let go of holes, stretched elastic and lone socks",
      why: "These are the items you touch every day. Keeping only good ones makes every morning a little better."
    },
    {
      id: "d36-phys", level: "phys", difficulty: 2,
      title: "Try on five items; keep only those that fit and that you like today",
      why: "Clothes kept for a past or future body take space from the person you are now."
    },
    {
      id: "d37-phys", level: "phys", difficulty: 1,
      title: "Name the ten items you wear most. What do they have in common?",
      why: "Your favorites reveal your real style: colors, fabrics and fits. That is the blueprint for every future purchase."
    },
    {
      id: "d38-phys", level: "phys", difficulty: 2,
      title: "Check every pair of shoes: repair, donate or let go",
      why: "Good shoes can often be resoled for far less than a new pair. Pairs that hurt will never become comfortable."
    },
    {
      id: "d39-phys", level: "phys", difficulty: 1,
      title: "Keep only the bags and backpacks you actually use",
      why: "Bags nest inside other bags and hide how many we own. Two or three good ones cover almost every need."
    },
    {
      id: "d40-phys", level: "phys", difficulty: 2,
      title: "Sort accessories: belts, scarves, hats and sunglasses",
      why: "Accessories are small, so they multiply unnoticed. Keep what you reach for and what completes your outfits."
    },
    {
      id: "d41-phys", level: "phys", difficulty: 2,
      title: "Clear the space under your bed",
      why: "Under-bed storage is out of sight and out of mind. Whatever is there should be something you'd deliberately choose to keep."
    },
    {
      id: "d42-phys", level: "phys", difficulty: 2,
      title: "Keep two sets of sheets per bed; donate the extras",
      why: "One set on the bed and one in the wash is enough. Animal shelters often gladly accept old sheets and towels."
    },
    {
      id: "d43-phys", level: "phys", difficulty: 1,
      title: "Reduce towels to what your household really uses",
      why: "Linen closets fill with towels no one reaches for. Fewer, better towels are easier to store and wash."
    },
    {
      id: "d44-phys", level: "phys", difficulty: 1,
      title: "Remove one thing from the bedroom that has nothing to do with rest",
      why: "Work papers, laundry piles and gym gear keep the mind 'on' at bedtime. A bedroom used only for rest makes rest easier."
    },
    {
      id: "d45-phys", level: "phys", difficulty: 1,
      title: "Deal with 'the chair' where worn clothes pile up",
      why: "Half-worn clothes need a home: a hook, a small rack, or simply the hanger or laundry basket. Choose one rule and use it."
    },
    {
      id: "d46-phys", level: "phys", difficulty: 1,
      title: "Gather sample and travel-size toiletries into one box and use them first",
      why: "Tiny bottles get forgotten until they expire. Using them up before buying new saves money and space."
    },
    {
      id: "d47-phys", level: "phys", difficulty: 2,
      title: "Sort makeup and grooming tools; clean the brushes you keep",
      why: "Makeup that's old or unused takes space and can harbor bacteria. What remains should be what you reach for."
    },
    {
      id: "d48-phys", level: "phys", difficulty: 1,
      title: "Let go of grooming gadgets you've used once or never",
      why: "Many gadgets promise a better routine, then sit in a drawer. Your real routine is what you actually do."
    },
    {
      id: "d49-phys", level: "phys", difficulty: 1,
      title: "Streamline the laundry area: one open product of each kind",
      why: "Five half-used detergents crowd the shelf. Finish what's open before buying more."
    },
    {
      id: "d50-phys", level: "phys", difficulty: 3,
      title: "Sentimental clothes: keep the most meaningful piece, photograph the rest",
      why: "Memories live in you, not in fabric. One treasured item honors the memory better than a box nobody opens."
    },
    {
      id: "d51-phys", level: "phys", difficulty: 1,
      title: "Define three go-to outfits you love and feel good in",
      why: "Knowing your default outfits removes daily decisions and shows which pieces are truly essential."
    },
    {
      id: "d52-phys", level: "phys", difficulty: 2,
      title: "Handle the mending pile: fix one item today or let the others go",
      why: "A pile of 'to fix' clothes can sit for years. Sew a button, take something to a tailor, or accept it won't happen."
    },
    {
      id: "d53-phys", level: "phys", difficulty: 1,
      title: "Remove spare hangers and replace mismatched ones if you want",
      why: "Extra hangers invite extra clothes. Keeping only the hangers you need sets a quiet limit on the wardrobe."
    },
    {
      id: "d54-phys", level: "phys", difficulty: 1,
      title: "Keep only the workout clothes you actually exercise in",
      why: "Activewear accumulates with every new resolution. What you wear to move is what matters."
    },
    {
      id: "d55-phys", level: "phys", difficulty: 2,
      title: "Box and label out-of-season clothes so the closet shows only this season",
      why: "A closet with only current clothes is faster to use. When the season changes, it's a natural checkpoint."
    },
    {
      id: "d56-phys", level: "phys", difficulty: 1,
      title: "Sort your jewelry: broken pieces, single earrings, tangled chains",
      why: "Repair what you love, let go of what you don't wear. A few visible pieces get worn more than a hidden pile."
    },
    {
      id: "d57-phys", level: "phys", difficulty: 1,
      title: "Keep only daily items visible on bathroom surfaces",
      why: "A clear sink area is quicker to clean and feels calmer every morning and evening."
    },
    {
      id: "d58-phys", level: "phys", difficulty: 1,
      title: "February review: count your wardrobe again and compare with the first count",
      why: "Seeing the difference in numbers makes progress concrete, and shows how little you missed what left."
    },
    {
      id: "d59-phys", level: "phys", difficulty: 2,
      title: "Start a dated 'maybe box' for items you're unsure about",
      why: "If you haven't needed anything from the box in 90 days, you can let it go without regret. Time makes the decision for you."
    },
    /* ===== PHYSICAL — DAYS 60–90 · MARCH · Spring cleaning ===== */
    {
      id: "d60-phys", level: "phys", difficulty: 3,
      title: "Empty the pantry, check dates, and bring near-expiry food to the front",
      why: "Spring cleaning starts with food. Seeing everything at once prevents waste and duplicate buying."
    },
    {
      id: "d61-phys", level: "phys", difficulty: 1,
      title: "Check your spices: combine duplicates, let go of those that lost their aroma",
      why: "Ground spices lose flavor over time. If a spice has no smell, it adds nothing to your food."
    },
    {
      id: "d62-phys", level: "phys", difficulty: 2,
      title: "Let go of single-purpose kitchen gadgets you haven't used in a year",
      why: "A good knife and a few basic tools do the work of most gadgets. Freed drawers make cooking smoother."
    },
    {
      id: "d63-phys", level: "phys", difficulty: 2,
      title: "Keep the pots and pans you cook with; donate the rest",
      why: "Most meals are cooked in the same two or three pans. The rest just make every cupboard harder to use."
    },
    {
      id: "d64-phys", level: "phys", difficulty: 2,
      title: "Reduce cleaning products to a few basics, and never mix bleach with other cleaners",
      why: "A handful of multi-purpose products cleans most homes. Mixing bleach with ammonia or acids releases toxic gases, so fewer products is also safer."
    },
    {
      id: "d65-phys", level: "phys", difficulty: 1,
      title: "Notice which room feels lightest now, and why",
      why: "Understanding what worked helps you repeat it in the spaces that still feel heavy."
    },
    {
      id: "d66-phys", level: "phys", difficulty: 2,
      title: "Clear windowsills and wash one window to let more light in",
      why: "Natural light makes any room feel larger. Windowsills are often the first surfaces to fill up."
    },
    {
      id: "d67-phys", level: "phys", difficulty: 1,
      title: "Clear under the kitchen sink and check for leaks",
      why: "This cupboard hides old products and slow leaks. A quick check prevents both clutter and water damage."
    },
    {
      id: "d68-phys", level: "phys", difficulty: 2,
      title: "Take inventory of your freezer and plan three meals from it",
      why: "Frozen food is easy to forget. Cooking from what you already have saves money and makes room."
    },
    {
      id: "d69-phys", level: "phys", difficulty: 2,
      title: "Keep the cookbooks you cook from; photograph single recipes from the rest",
      why: "Many cookbooks are kept for one or two recipes. A photo keeps the recipe without the shelf space."
    },
    {
      id: "d70-phys", level: "phys", difficulty: 1,
      title: "Sort kitchen towels, oven mitts and aprons; keep the ones in good shape",
      why: "Worn-out textiles are easy to replace and pile up quickly. A small fresh set is all a kitchen needs."
    },
    {
      id: "d71-phys", level: "phys", difficulty: 1,
      title: "Keep only the water bottles and travel mugs you actually carry",
      why: "Free promotional bottles and mugs pile up fast. One or two good ones are enough for daily use."
    },
    {
      id: "d72-phys", level: "phys", difficulty: 1,
      title: "Set a 15-minute daily tidy timer for this week",
      why: "Short, time-boxed sessions remove the dread of 'tidying up'. Fifteen minutes a day adds up to almost two hours a week."
    },
    {
      id: "d73-phys", level: "phys", difficulty: 3,
      title: "Review small appliances: which ones haven't been used in six months?",
      why: "Bread makers, juicers and waffle irons often promise a lifestyle we don't live. Sell or donate what sits idle."
    },
    {
      id: "d74-phys", level: "phys", difficulty: 2,
      title: "Match your dishes and cutlery to the number of guests you really host",
      why: "Service for twelve makes sense only if you host twelve. Store enough for your real life, not a hypothetical party."
    },
    {
      id: "d75-phys", level: "phys", difficulty: 1,
      title: "Gather used batteries and take them to a battery collection bin",
      why: "Batteries contain metals that shouldn't go into regular waste. Most supermarkets and shops have a collection box."
    },
    {
      id: "d76-phys", level: "phys", difficulty: 2,
      title: "Collect unused chargers, cables and old gadgets for electronics recycling",
      why: "Old electronics contain valuable and hazardous materials. Erase any personal data first, then take them to an e-waste collection point."
    },
    {
      id: "d77-phys", level: "phys", difficulty: 1,
      title: "Test light bulbs and extension cords; keep only those that work safely",
      why: "Damaged cords are a fire risk, and dead bulbs are just clutter in a drawer."
    },
    {
      id: "d78-phys", level: "phys", difficulty: 1,
      title: "Give your entrance a deep clean: floor, mat, hooks and shoe rack",
      why: "The entrance is the first thing you see coming home. A clean one sets the tone for the whole house."
    },
    {
      id: "d79-phys", level: "phys", difficulty: 1,
      title: "Walk into each room and ask: what here doesn't belong?",
      why: "Items drift between rooms over time. Returning them to their proper room often solves 'clutter' instantly."
    },
    {
      id: "d80-phys", level: "phys", difficulty: 2,
      title: "Check your first-aid kit; restock essentials and remove expired items",
      why: "A first-aid kit is only useful if you can trust it in an emergency. Take expired medicines to a pharmacy, not the trash."
    },
    {
      id: "d81-phys", level: "phys", difficulty: 1,
      title: "Reduce candles and small decorative items to your true favorites",
      why: "Decor works best with breathing room. A few chosen objects stand out; many compete for attention."
    },
    {
      id: "d82-phys", level: "phys", difficulty: 1,
      title: "Care for your plants, or rehome the ones you can't look after",
      why: "A struggling plant is a small daily reproach. A friend with the right light may help it thrive."
    },
    {
      id: "d83-phys", level: "phys", difficulty: 1,
      title: "Let go of empty vases and planters you haven't used in a year",
      why: "Empty containers collect in cupboards 'for someday'. Keep one or two and pass on the rest."
    },
    {
      id: "d84-phys", level: "phys", difficulty: 1,
      title: "Limit gift wrap, ribbons and gift bags to one small box",
      why: "Wrapping supplies spread across the house. One box sets a clear, visible limit."
    },
    {
      id: "d85-phys", level: "phys", difficulty: 2,
      title: "Sort craft and hobby supplies; keep materials for projects you'll start this year",
      why: "Supplies for abandoned projects quietly carry guilt. Pass them to a school, a friend or a community group."
    },
    {
      id: "d86-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear every flat surface in the living room",
      why: "Flat surfaces attract clutter like magnets. A quick weekly sweep keeps them usable."
    },
    {
      id: "d87-phys", level: "phys", difficulty: 1,
      title: "Keep a small stash of paper bags and boxes; recycle the rest",
      why: "Everyone saves a few 'useful' boxes, but the stash tends to grow. Decide on a limit and stick to it."
    },
    {
      id: "d88-phys", level: "phys", difficulty: 2,
      title: "Remove one storage box or basket you no longer need",
      why: "More storage often means more stuff. Once a space is decluttered, extra containers can go too."
    },
    {
      id: "d89-phys", level: "phys", difficulty: 1,
      title: "Write a simple weekly cleaning list on a single page",
      why: "A clear list means you never have to decide what to clean next. Fewer possessions also make the list shorter."
    },
    {
      id: "d90-phys", level: "phys", difficulty: 2,
      title: "Spring cleaning finale: deep clean the room you use most",
      why: "After a month of decluttering, cleaning goes much faster. Enjoy how much easier it is with less in the way."
    },
    /* ===== PHYSICAL — DAYS 91–120 · APRIL · Living spaces & books ===== */
    {
      id: "d91-phys", level: "phys", difficulty: 3,
      title: "Start a three-month capsule: choose 33 items to wear, box the rest out of sight",
      why: "This is the idea behind Project 333: clothing, shoes and accessories count; underwear, sleepwear and workout clothes don't. Nothing needs to be thrown away, just stored."
    },
    {
      id: "d92-phys", level: "phys", difficulty: 2,
      title: "Sort your books: keep the ones you love or will read this year",
      why: "Books are easy to keep and hard to let go. A shelf of books you truly value says more than a wall of unread ones."
    },
    {
      id: "d93-phys", level: "phys", difficulty: 1,
      title: "Donate books to a library, school or neighborhood book exchange",
      why: "A book on a shelf does nothing; a book in someone's hands does. Giving books away extends their life."
    },
    {
      id: "d94-phys", level: "phys", difficulty: 2,
      title: "Sort DVDs, CDs, vinyl and physical games; keep the ones you replay",
      why: "Most physical media is now available on demand. Keep what has real value for you and pass on the rest."
    },
    {
      id: "d95-phys", level: "phys", difficulty: 2,
      title: "Tidy the cables behind the TV or desk and label each plug",
      why: "Cable tangles are visual noise and make cleaning harder. Labels save time when you need to unplug something."
    },
    {
      id: "d96-phys", level: "phys", difficulty: 1,
      title: "Gather all remote controls; keep only those for devices you still own",
      why: "Old remotes linger long after the devices are gone. Fewer remotes, less confusion on the couch."
    },
    {
      id: "d97-phys", level: "phys", difficulty: 1,
      title: "Check board games and puzzles for missing pieces",
      why: "An incomplete game won't be played. Keep the ones that bring people together and are complete."
    },
    {
      id: "d98-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes, one room, everything back in place",
      why: "Consistency beats intensity. The same short ritual each week keeps the gains of the past months."
    },
    {
      id: "d99-phys", level: "phys", difficulty: 1,
      title: "Remove half the decor from one shelf for a week; see what you miss",
      why: "Absence reveals value. What you don't miss after a week probably wasn't adding much."
    },
    {
      id: "d100-phys", level: "phys", difficulty: 2,
      title: "Day 100: photograph every room and compare with how it looked in January",
      why: "A hundred days of small actions add up. Side-by-side photos make that visible."
    },
    {
      id: "d101-phys", level: "phys", difficulty: 1,
      title: "Reduce throw pillows and blankets to what you actually use",
      why: "Too many cushions end up on the floor every night. A few you love are cozier and easier to wash."
    },
    {
      id: "d102-phys", level: "phys", difficulty: 2,
      title: "Review what hangs on your walls; keep only what you love to look at",
      why: "Walls are the backdrop of daily life. Art and photos you love deserve space, not company."
    },
    {
      id: "d103-phys", level: "phys", difficulty: 2,
      title: "Sort old greeting cards and letters; keep the ones that truly move you",
      why: "A card's job is done when it's read. Keep the few with real personal words; recycle the rest without guilt."
    },
    {
      id: "d104-phys", level: "phys", difficulty: 2,
      title: "Keep the travel souvenirs that tell a story; let go of the rest",
      why: "Many souvenirs are bought on impulse and forgotten. The ones that spark a memory can stay and be displayed."
    },
    {
      id: "d105-phys", level: "phys", difficulty: 3,
      title: "Open one sentimental box and decide about every item in it",
      why: "Sentimental items are hardest, so they're best left until your decision muscles are trained. Choose a few treasures to display instead of a box you never open."
    },
    {
      id: "d106-phys", level: "phys", difficulty: 1,
      title: "For one week, write down every non-food purchase you make",
      why: "Awareness is the first filter. Seeing your purchases listed shows which ones truly mattered."
    },
    {
      id: "d107-phys", level: "phys", difficulty: 2,
      title: "Look at one collection: is it still a joy or has it become a duty?",
      why: "Collections often outlive the interest that started them. Keep the best pieces and release the obligation."
    },
    {
      id: "d108-phys", level: "phys", difficulty: 1,
      title: "Donate old eyeglasses through an optician or charity that collects them",
      why: "Old glasses sit in drawers for years. Some opticians and charities collect them for reuse."
    },
    {
      id: "d109-phys", level: "phys", difficulty: 1,
      title: "Keep one or two umbrellas in good shape; let broken ones go",
      why: "Umbrellas multiply because we buy one each time we forget ours. Knowing where yours is solves that."
    },
    {
      id: "d110-phys", level: "phys", difficulty: 1,
      title: "Identify every key you own; remove the ones that open nothing",
      why: "Mystery keys add weight and confusion. Label the spare keys you keep."
    },
    {
      id: "d111-phys", level: "phys", difficulty: 1,
      title: "Gather loose coins from jars and drawers, and spend or deposit them",
      why: "Scattered coins are money doing nothing. Collected, they often add up to a nice surprise."
    },
    {
      id: "d112-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear the kitchen counter again",
      why: "Surfaces refill quietly. Returning to a cleared spot each week is how new habits stick."
    },
    {
      id: "d113-phys", level: "phys", difficulty: 3,
      title: "Sell or give away one piece of furniture you don't really use",
      why: "Furniture shapes how we move through a room. Removing one piece can change the whole feel of a space."
    },
    {
      id: "d114-phys", level: "phys", difficulty: 2,
      title: "Rearrange one room around how you actually use it",
      why: "Rooms are often arranged once and never questioned. A new layout with fewer pieces can make a room more useful."
    },
    {
      id: "d115-phys", level: "phys", difficulty: 1,
      title: "Review rugs and mats; keep the ones that are clean and needed",
      why: "Too many rugs make a room feel busy and gather dust. Fewer, well-chosen ones look calmer."
    },
    {
      id: "d116-phys", level: "phys", difficulty: 2,
      title: "Clear the top of your wardrobe or tall cabinets",
      why: "Things stored up high are easily forgotten. If you didn't remember they were there, you probably don't need them."
    },
    {
      id: "d117-phys", level: "phys", difficulty: 2,
      title: "Open your storage room or basement and simply list what's there",
      why: "Before deciding, just look. A written list turns a scary space into a manageable set of decisions."
    },
    {
      id: "d118-phys", level: "phys", difficulty: 2,
      title: "Pass on hobby or sports equipment you've outgrown",
      why: "An instrument or racket you no longer use could start someone else's passion."
    },
    {
      id: "d119-phys", level: "phys", difficulty: 1,
      title: "April review: which decision this month was the hardest, and why?",
      why: "Hard decisions show where your attachments lie. Understanding them makes the next ones easier."
    },
    {
      id: "d120-phys", level: "phys", difficulty: 1,
      title: "Donate unopened toiletries to a shelter or social grocery",
      why: "Unused soaps, shampoos and toothpaste are useful to people in need. Many local organizations accept them."
    },
    /* ===== PHYSICAL — DAYS 121–151 · MAY · Storage, balcony & tools ===== */
    {
      id: "d121-phys", level: "phys", difficulty: 2,
      title: "Clear your balcony or outdoor space so it's ready for warm days",
      why: "Balconies often become storage. A cleared one becomes an extra room for the warm months."
    },
    {
      id: "d122-phys", level: "phys", difficulty: 1,
      title: "Clean your outdoor furniture and remove what's broken or unused",
      why: "Worn-out chairs and broken tables clutter outdoor space. A few solid pieces are enough to enjoy it."
    },
    {
      id: "d123-phys", level: "phys", difficulty: 1,
      title: "Sort gardening tools and empty pots; keep only what you use",
      why: "Garden supplies pile up in corners. Keep what's working and give spare pots to a neighbor who gardens."
    },
    {
      id: "d124-phys", level: "phys", difficulty: 2,
      title: "Consolidate your toolbox to the essential tools you actually use",
      why: "A compact, complete toolbox makes small repairs faster. Duplicates and specialty tools can be borrowed when needed."
    },
    {
      id: "d125-phys", level: "phys", difficulty: 1,
      title: "Sort the jar of screws, nails and spare parts",
      why: "Loose hardware is useful only if you can find the right piece. A few small labeled containers turn chaos into a resource."
    },
    {
      id: "d126-phys", level: "phys", difficulty: 2,
      title: "Take old paints, solvents and chemicals to a proper collection point",
      why: "These don't belong in household trash or drains. Your municipality can tell you where hazardous household waste is collected."
    },
    {
      id: "d127-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: sweep through the entrance and hallway",
      why: "The entrance catches everything on its way in. A weekly pass keeps it welcoming."
    },
    {
      id: "d128-phys", level: "phys", difficulty: 3,
      title: "Empty one shelf in your storage room completely and decide on each item",
      why: "Storage rooms hold years of deferred decisions. One shelf at a time makes the job doable."
    },
    {
      id: "d129-phys", level: "phys", difficulty: 2,
      title: "Keep the sports gear you use; donate the rest to a club or school",
      why: "Equipment for sports you've stopped is better used by someone who plays today."
    },
    {
      id: "d130-phys", level: "phys", difficulty: 2,
      title: "Repair the bicycle you don't ride, or give it to someone who will",
      why: "A bike with flat tires is clutter; a working bike is freedom. Decide which one yours will be."
    },
    {
      id: "d131-phys", level: "phys", difficulty: 1,
      title: "Check camping and beach gear before summer; fix or release",
      why: "It's better to find a torn tent or broken umbrella now than on the first day of your trip."
    },
    {
      id: "d132-phys", level: "phys", difficulty: 1,
      title: "Keep only the suitcases that match how you really travel",
      why: "Suitcases take up a lot of space for items used a few times a year. Store smaller ones inside larger ones."
    },
    {
      id: "d133-phys", level: "phys", difficulty: 1,
      title: "Do a quick check of holiday decorations while you're in storage",
      why: "It's easier to decide calmly now than in the rush of December. Broken lights and faded items can go."
    },
    {
      id: "d134-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear your desk and nightstand",
      why: "Personal surfaces fill up first. A weekly clear-out keeps them working for you."
    },
    {
      id: "d135-phys", level: "phys", difficulty: 3,
      title: "Tackle the garage or parking corner: sort everything into keep, give, recycle",
      why: "Garages collect what the house rejects. A clear garage is safer and more useful."
    },
    {
      id: "d136-phys", level: "phys", difficulty: 1,
      title: "Empty the car trunk of everything that doesn't need to be there",
      why: "Extra weight also increases fuel use. Keep a simple emergency kit and remove the rest."
    },
    {
      id: "d137-phys", level: "phys", difficulty: 2,
      title: "Let go of leftover building materials from past renovations",
      why: "Spare tiles and planks are kept 'just in case' for years. Keep a small amount for repairs, give the rest away."
    },
    {
      id: "d138-phys", level: "phys", difficulty: 1,
      title: "Sort pet supplies: toys, beds, leashes and old food",
      why: "Pets need less than we buy them. Donate unused items to an animal shelter."
    },
    {
      id: "d139-phys", level: "phys", difficulty: 1,
      title: "Check insect repellents and garden products; dispose of old ones safely",
      why: "Old chemical products lose effectiveness and can be hazardous. Check the label for disposal instructions."
    },
    {
      id: "d140-phys", level: "phys", difficulty: 2,
      title: "Fix one small thing that has been annoying you for months",
      why: "A squeaky door or loose handle is a tiny daily irritation. Fixing it removes friction you've stopped noticing."
    },
    {
      id: "d141-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: one bag of items leaves the house this week",
      why: "A regular exit route keeps things flowing out as naturally as they flow in."
    },
    {
      id: "d142-phys", level: "phys", difficulty: 2,
      title: "List three items for sale online today",
      why: "Selling recovers some value and gives items a second life. Set a deadline: unsold by next month means donate."
    },
    {
      id: "d143-phys", level: "phys", difficulty: 1,
      title: "Offer something for free in a local giveaway group",
      why: "Giving to a neighbor is fast and personal. Someone nearby may need exactly what you no longer use."
    },
    {
      id: "d144-phys", level: "phys", difficulty: 2,
      title: "Join or organize a clothing or item swap with friends",
      why: "Swaps refresh your things without buying anything new, and they're fun."
    },
    {
      id: "d145-phys", level: "phys", difficulty: 1,
      title: "List items you could borrow or share with neighbors instead of owning",
      why: "A drill is used for minutes in its lifetime. Sharing rarely used tools saves money and space for everyone."
    },
    {
      id: "d146-phys", level: "phys", difficulty: 2,
      title: "Maintenance day: clean air-conditioner filters and oil squeaky hinges",
      why: "Caring for what you own makes it last longer. Clean filters also help an air conditioner run more efficiently in summer."
    },
    {
      id: "d147-phys", level: "phys", difficulty: 1,
      title: "Clear the laundry drying area of clutter",
      why: "Drying racks and pegs spread over time. A clear drying space makes laundry day quicker."
    },
    {
      id: "d148-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: return borrowed items to their owners",
      why: "Borrowed things are easy to forget, and they aren't yours to store. Returning them clears space and strengthens relationships."
    },
    {
      id: "d149-phys", level: "phys", difficulty: 2,
      title: "Check the high shelves and cabinet tops for forgotten items",
      why: "What's stored out of reach is often out of use. Bring it down and decide."
    },
    {
      id: "d150-phys", level: "phys", difficulty: 2,
      title: "Clear the guest room, sofa bed or spare corner that has become storage",
      why: "Guest spaces tend to fill with overflow. A cleared one is ready to welcome people."
    },
    {
      id: "d151-phys", level: "phys", difficulty: 1,
      title: "May review: what left the house this month, and what came in?",
      why: "Tracking both directions shows whether your home is actually getting lighter."
    },
    /* ===== PHYSICAL — DAYS 152–181 · JUNE · Summer & travel ===== */
    {
      id: "d152-phys", level: "phys", difficulty: 3,
      title: "Switch your wardrobe to summer: wash and store heavy winter clothes",
      why: "Storing clothes clean protects them from moths and stains. It's also a natural moment to let go of what you didn't wear."
    },
    {
      id: "d153-phys", level: "phys", difficulty: 2,
      title: "Wash and store winter blankets and duvets",
      why: "Bulky bedding takes over closets. Vacuum bags or a single box keep it compact until autumn."
    },
    {
      id: "d154-phys", level: "phys", difficulty: 1,
      title: "Check sunscreen expiry dates; replace only what has expired",
      why: "Sunscreen loses effectiveness after its expiry date. One reliable bottle beats five questionable ones."
    },
    {
      id: "d155-phys", level: "phys", difficulty: 1,
      title: "Pack a minimal, ready-to-go beach bag",
      why: "A bag that's always ready makes spontaneous swims easy. Keep only what you use every time."
    },
    {
      id: "d156-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: tidy the bathroom surfaces again",
      why: "The bathroom is used several times a day, so it drifts quickly. A short weekly pass keeps it easy."
    },
    {
      id: "d157-phys", level: "phys", difficulty: 1,
      title: "Write a reusable packing list for a carry-on-only trip",
      why: "A tested list removes packing stress and prevents overpacking. Most trips need far less than we think."
    },
    {
      id: "d158-phys", level: "phys", difficulty: 1,
      title: "Build a minimal toiletry kit with small refillable containers",
      why: "Refillable bottles reduce waste and keep you within liquid limits for carry-on luggage."
    },
    {
      id: "d159-phys", level: "phys", difficulty: 1,
      title: "Sort travel accessories: adapters, neck pillows, locks and organizers",
      why: "Travel gadgets are cheap to buy and easy to accumulate. Keep one of each that you actually use."
    },
    {
      id: "d160-phys", level: "phys", difficulty: 2,
      title: "Practice-pack for your next trip using only a carry-on",
      why: "Packing light means less to carry, lose or wait for. A trial run shows what you truly need."
    },
    {
      id: "d161-phys", level: "phys", difficulty: 1,
      title: "Set a souvenir rule: experiences, photos or consumables only",
      why: "Local food, a photo or a memory doesn't need shelf space. It's a simple way to travel without bringing clutter home."
    },
    {
      id: "d162-phys", level: "phys", difficulty: 1,
      title: "Sort summer hats, sandals and flip-flops",
      why: "Summer footwear wears out quickly. Keep the pairs that are comfortable and in good shape."
    },
    {
      id: "d163-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear the dining table after every meal this week",
      why: "A table cleared after each meal never becomes a storage surface."
    },
    {
      id: "d164-phys", level: "phys", difficulty: 1,
      title: "Plan to empty the fridge before your summer holiday",
      why: "Cooking down what's in the fridge avoids coming home to spoiled food."
    },
    {
      id: "d165-phys", level: "phys", difficulty: 1,
      title: "Sort swimwear and sunglasses; keep the ones you actually wear",
      why: "Swimsuits lose elasticity with sun and chlorine. Two or three that fit well are enough."
    },
    {
      id: "d166-phys", level: "phys", difficulty: 2,
      title: "Prepare your home for the heat: roll up rugs, remove heavy textiles",
      why: "Fewer textiles means cooler rooms and less dust. The home breathes more easily in summer."
    },
    {
      id: "d167-phys", level: "phys", difficulty: 1,
      title: "Check inflatables and water toys for holes; let go of broken ones",
      why: "Leaking inflatables are quickly replaced and rarely repaired. Keep what's intact."
    },
    {
      id: "d168-phys", level: "phys", difficulty: 1,
      title: "Keep only the kitchen tools you need for simple summer meals within reach",
      why: "In hot weather, cooking gets simpler. Put away what you won't need until autumn."
    },
    {
      id: "d169-phys", level: "phys", difficulty: 1,
      title: "Unplug devices you rarely use to cut standby power",
      why: "Standby power adds up over a year. Fewer plugged-in devices also means fewer cables in sight."
    },
    {
      id: "d170-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes, whichever room needs it most",
      why: "Letting the house tell you where to focus is a sign your system is working."
    },
    {
      id: "d171-phys", level: "phys", difficulty: 1,
      title: "Pick your summer reading from your own shelf instead of buying new",
      why: "Many of us own books we bought and never read. Summer is the perfect time to finally enjoy them."
    },
    {
      id: "d172-phys", level: "phys", difficulty: 2,
      title: "Agree on one simple tidiness rule with the people you live with",
      why: "Shared spaces need shared rules. One clear agreement works better than constant reminders."
    },
    {
      id: "d173-phys", level: "phys", difficulty: 1,
      title: "Put together a simple picnic kit with reusable items",
      why: "A small ready kit makes eating outdoors easy and avoids disposable plastics."
    },
    {
      id: "d174-phys", level: "phys", difficulty: 2,
      title: "Before leaving on holiday, tidy the house so you come back to calm",
      why: "Returning to a clean, clear home makes the end of a holiday gentler."
    },
    {
      id: "d175-phys", level: "phys", difficulty: 2,
      title: "Pass on seasonal items you didn't use last summer",
      why: "If something sat unused through a whole summer, it's likely to do the same this year."
    },
    {
      id: "d176-phys", level: "phys", difficulty: 1,
      title: "Identify your biggest clutter hotspot and give it a simple rule",
      why: "Every home has a place where clutter always returns. A clear rule, like 'nothing stays overnight', stops the cycle."
    },
    {
      id: "d177-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: empty your everyday bag completely",
      why: "Bags slowly fill with receipts, wrappers and extras. Starting fresh lightens your shoulders and your mind."
    },
    {
      id: "d178-phys", level: "phys", difficulty: 1,
      title: "Carry less this summer: reduce your bag to true essentials",
      why: "A lighter bag is more comfortable in the heat. Most days need only keys, phone, wallet and water."
    },
    {
      id: "d179-phys", level: "phys", difficulty: 2,
      title: "Revisit your 'maybe box': anything you didn't open for can go",
      why: "Time has made the decision for you. Donate the box without reopening it, if you can."
    },
    {
      id: "d180-phys", level: "phys", difficulty: 1,
      title: "Half-year review: write down what has changed in your home and habits",
      why: "Six months of small steps is a real transformation. Recognizing it builds motivation for the second half."
    },
    {
      id: "d181-phys", level: "phys", difficulty: 1,
      title: "Plan your next 33-item capsule: what worked, what didn't?",
      why: "Your last capsule taught you what you really wear. Use that to choose better for the summer."
    },
    /* ===== PHYSICAL — DAYS 182–212 · JULY · Paper & documents ===== */
    {
      id: "d182-phys", level: "phys", difficulty: 3,
      title: "Start your summer capsule: 33 items for the next three months, the rest stored away",
      why: "Fewer choices each morning means more energy for the day. Store the rest out of sight and notice how little you miss it."
    },
    {
      id: "d183-phys", level: "phys", difficulty: 2,
      title: "Gather every loose paper document in the house into one place",
      why: "Papers scattered across rooms are impossible to manage. Seeing them all together is the first step to a simple system."
    },
    {
      id: "d184-phys", level: "phys", difficulty: 2,
      title: "Set up a simple filing system with just a few categories",
      why: "Home, health, money, work, identity: five folders cover most households. Simple systems get used."
    },
    {
      id: "d185-phys", level: "phys", difficulty: 2,
      title: "Recycle old bills and statements you no longer need to keep",
      why: "Check how long you must keep tax and financial documents where you live, then shred or recycle the rest safely."
    },
    {
      id: "d186-phys", level: "phys", difficulty: 3,
      title: "Scan important documents; keep originals only of those that need them",
      why: "Birth certificates, deeds and contracts need originals; many other papers only need a clear scan stored safely."
    },
    {
      id: "d187-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: process any new paper that came in this week",
      why: "Paper enters the home daily. A weekly habit stops it from piling up again."
    },
    {
      id: "d188-phys", level: "phys", difficulty: 1,
      title: "Keep warranties for things you still own; recycle expired ones",
      why: "A warranty is only useful while it's valid. One folder for active warranties is enough."
    },
    {
      id: "d189-phys", level: "phys", difficulty: 2,
      title: "Go through old notebooks and school notes; keep only what you'd reread",
      why: "Old notes rarely get reread. Keep a few that mean something and photograph pages you want to remember."
    },
    {
      id: "d190-phys", level: "phys", difficulty: 1,
      title: "Save business cards as phone contacts, then recycle the cards",
      why: "A contact in your phone is searchable; a card in a drawer is not."
    },
    {
      id: "d191-phys", level: "phys", difficulty: 1,
      title: "Switch one paper bill or statement to electronic delivery",
      why: "Every paper bill you stop is paper you never need to sort, file or shred."
    },
    {
      id: "d192-phys", level: "phys", difficulty: 1,
      title: "Put a 'no advertising leaflets' note on your mailbox",
      why: "Flyers are clutter that arrives uninvited. Stopping them at the door is easier than recycling them later."
    },
    {
      id: "d193-phys", level: "phys", difficulty: 2,
      title: "If you live with children, store half the toys and rotate them monthly",
      why: "Fewer toys at a time often means deeper play. Rotated toys feel new again."
    },
    {
      id: "d194-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear the fridge door of old notes and flyers",
      why: "The fridge door is a noticeboard that never gets cleaned. Keep only what's current."
    },
    {
      id: "d195-phys", level: "phys", difficulty: 1,
      title: "Reduce stationery overflow: notepads, sticky notes, envelopes",
      why: "Stationery is cheap and multiplies. Keep what fits in one drawer and donate the rest to a school."
    },
    {
      id: "d196-phys", level: "phys", difficulty: 2,
      title: "Create one 'essentials' folder: IDs, passports, insurance and key contacts",
      why: "In an emergency, you shouldn't have to search. One folder, one known place."
    },
    {
      id: "d197-phys", level: "phys", difficulty: 1,
      title: "Check the expiry dates of your ID, passport and driving license",
      why: "Renewing in time avoids last-minute stress before travel. Note the dates in your calendar."
    },
    {
      id: "d198-phys", level: "phys", difficulty: 1,
      title: "Sort drawing paper, art supplies and half-used sketchbooks",
      why: "Keep the supplies you'll use and let the rest inspire someone else."
    },
    {
      id: "d199-phys", level: "phys", difficulty: 1,
      title: "Use one notebook for everything instead of several half-used ones",
      why: "One notebook is easy to carry and easy to search. Scattered notebooks scatter your thoughts."
    },
    {
      id: "d200-phys", level: "phys", difficulty: 2,
      title: "Day 200: find one area that slipped back and restore it",
      why: "Relapse is normal. Returning to an area without guilt is what keeps the change permanent."
    },
    {
      id: "d201-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: put away everything left out overnight",
      why: "A home that is reset each night starts each day calm."
    },
    {
      id: "d202-phys", level: "phys", difficulty: 1,
      title: "Clear the bulletin board or pinboard; keep only what's current",
      why: "Old notices lose meaning but stay pinned for years. A clear board makes new information stand out."
    },
    {
      id: "d203-phys", level: "phys", difficulty: 1,
      title: "Clear the top of the washing machine",
      why: "It's a flat surface in a busy area, so it collects things. A cleared top makes laundry smoother."
    },
    {
      id: "d204-phys", level: "phys", difficulty: 1,
      title: "Sort supplements and vitamins; stop buying what you don't take",
      why: "Half-used bottles of supplements are common. Keep only what you take consistently, and ask a doctor if unsure."
    },
    {
      id: "d205-phys", level: "phys", difficulty: 2,
      title: "Finish one unfinished project, or officially let it go",
      why: "Unfinished projects hold both space and mental energy. Completing or releasing one frees both."
    },
    {
      id: "d206-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes in the kitchen",
      why: "The kitchen is the busiest room. A short weekly reset keeps it the easiest room to use."
    },
    {
      id: "d207-phys", level: "phys", difficulty: 1,
      title: "Organize car documents into one folder in the glove box",
      why: "Insurance, registration and roadside assistance should be easy to find, and old copies removed."
    },
    {
      id: "d208-phys", level: "phys", difficulty: 1,
      title: "Keep one coat per person on the entrance hooks",
      why: "Overloaded hooks hide what you need. Store the rest in a closet."
    },
    {
      id: "d209-phys", level: "phys", difficulty: 1,
      title: "Finish open packages in the pantry before opening new ones",
      why: "Open packages go stale when new ones are started. Using up what's open reduces waste."
    },
    {
      id: "d210-phys", level: "phys", difficulty: 1,
      title: "List what you'd take in an emergency and keep those items easy to reach",
      why: "Knowing what matters most is clarifying. It also shows how much of the rest you could live without."
    },
    {
      id: "d211-phys", level: "phys", difficulty: 1,
      title: "July review: how does your paper situation feel now?",
      why: "Paper is one of the most common sources of stress at home. Notice the difference a system makes."
    },
    {
      id: "d212-phys", level: "phys", difficulty: 3,
      title: "Start a 30-day pause on non-essential purchases",
      why: "Decluttering only lasts if less comes in. A month without non-essential buying resets habits and shows what you truly need."
    },
    /* ===== PHYSICAL — DAYS 213–243 · AUGUST · Slow living & buying less ===== */
    {
      id: "d213-phys", level: "phys", difficulty: 1,
      title: "Write your list of allowed essentials for this month",
      why: "Food, medicine, toiletries that ran out, repairs. A clear list prevents the pause from feeling like punishment."
    },
    {
      id: "d214-phys", level: "phys", difficulty: 1,
      title: "Ask stores to stop sending you printed catalogs",
      why: "Catalogs are designed to create desire. Fewer of them in the mailbox means fewer impulses."
    },
    {
      id: "d215-phys", level: "phys", difficulty: 2,
      title: "Repair one item instead of replacing it",
      why: "Repair saves money and resources and builds a different relationship with your things."
    },
    {
      id: "d216-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: one surface, fully clear, in every room",
      why: "A single clear surface per room is enough to make each room feel calmer."
    },
    {
      id: "d217-phys", level: "phys", difficulty: 1,
      title: "Start a 30-day wishlist: write it down and wait before buying",
      why: "Most wants fade within a month. What's still on the list after 30 days is worth considering."
    },
    {
      id: "d218-phys", level: "phys", difficulty: 1,
      title: "Pick one category, like shampoo or notebooks, and use it up before buying more",
      why: "Most homes have hidden stockpiles. Using them up saves money and clears shelves."
    },
    {
      id: "d219-phys", level: "phys", difficulty: 1,
      title: "Borrow a book, tool or game from a library instead of buying it",
      why: "Libraries let you enjoy things without owning them. Access matters more than ownership."
    },
    {
      id: "d220-phys", level: "phys", difficulty: 1,
      title: "Rediscover something you own but forgot you had",
      why: "Forgotten items are often exactly what we were about to buy again. Enjoy what's already yours."
    },
    {
      id: "d221-phys", level: "phys", difficulty: 2,
      title: "Cook for a whole day using only what's already in your kitchen",
      why: "It's a creative challenge that reduces food waste and shows how much you already have."
    },
    {
      id: "d222-phys", level: "phys", difficulty: 1,
      title: "Clean and care for one thing you love: shoes, a bag, a jacket",
      why: "Caring for your things deepens appreciation and makes them last."
    },
    {
      id: "d223-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: return everything to the room it belongs in",
      why: "Things drift during summer days. A quick sweep puts the house back in order."
    },
    {
      id: "d224-phys", level: "phys", difficulty: 1,
      title: "Spend free time at a free place instead of a shop",
      why: "Parks, beaches, museums on free days: leisure doesn't need to include buying."
    },
    {
      id: "d225-phys", level: "phys", difficulty: 1,
      title: "When you feel the urge to buy, write down what triggered it",
      why: "Boredom, stress and advertising are common triggers. Naming them weakens their pull."
    },
    {
      id: "d226-phys", level: "phys", difficulty: 1,
      title: "Calculate the cost per wear of three pieces of clothing",
      why: "An expensive coat worn for years can cost less per wear than a cheap shirt worn twice. It's a better measure of value."
    },
    {
      id: "d227-phys", level: "phys", difficulty: 2,
      title: "Give something you love but don't use to someone who will",
      why: "Letting a cherished item go to the right person turns loss into generosity."
    },
    {
      id: "d228-phys", level: "phys", difficulty: 1,
      title: "Tonight, make sure nothing is left on the floor in one room",
      why: "Clear floors make a room look instantly larger and easier to clean."
    },
    {
      id: "d229-phys", level: "phys", difficulty: 2,
      title: "Clear the floor of one room completely and keep it that way for a week",
      why: "Floors are not storage. A week of discipline in one room builds a lasting habit."
    },
    {
      id: "d230-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: tidy the entrance and empty your bags",
      why: "Coming and going in summer brings sand, flyers and extras. A weekly clear-out keeps it light."
    },
    {
      id: "d231-phys", level: "phys", difficulty: 1,
      title: "When something needs replacing, research a durable, repairable option",
      why: "Buying once and well is the most sustainable minimalism. Quality reduces future clutter."
    },
    {
      id: "d232-phys", level: "phys", difficulty: 1,
      title: "Sew on a missing button or fix a small tear",
      why: "Small repairs take minutes and give clothes years more life."
    },
    {
      id: "d233-phys", level: "phys", difficulty: 1,
      title: "Read the care labels of your favorite clothes and wash accordingly",
      why: "Correct washing keeps clothes looking good far longer, so you need fewer of them."
    },
    {
      id: "d234-phys", level: "phys", difficulty: 1,
      title: "Spend an afternoon at home doing nothing in a clear space",
      why: "A decluttered home is meant to be enjoyed. Rest is part of the point."
    },
    {
      id: "d235-phys", level: "phys", difficulty: 1,
      title: "Prepare tomorrow's clothes and bag tonight",
      why: "Evening preparation makes mornings calm. It's easier when you own fewer, well-chosen things."
    },
    {
      id: "d236-phys", level: "phys", difficulty: 1,
      title: "Tidy your balcony plants: remove dead ones and empty pots",
      why: "Late summer is hard on plants. Clearing what didn't survive refreshes the space."
    },
    {
      id: "d237-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes in the bedroom",
      why: "The bedroom deserves to stay restful. A short weekly reset protects your sleep space."
    },
    {
      id: "d238-phys", level: "phys", difficulty: 2,
      title: "Pass on summer items you know you won't use again",
      why: "End of summer is the best moment to decide, while the memory of what you used is fresh."
    },
    {
      id: "d239-phys", level: "phys", difficulty: 1,
      title: "Check your 30-day wishlist: what do you still want?",
      why: "Most items will have lost their appeal. What remains is a considered choice, not an impulse."
    },
    {
      id: "d240-phys", level: "phys", difficulty: 2,
      title: "Prepare one compact emergency kit: flashlight, water, batteries, first aid",
      why: "Being prepared doesn't require a lot of stuff. One organized box beats scattered supplies."
    },
    {
      id: "d241-phys", level: "phys", difficulty: 3,
      title: "Clear flammable clutter from your balcony, yard or garden",
      why: "In hot, dry months, piles of wood, paper, dry plants and old furniture outdoors can feed a fire. Less clutter is also safer."
    },
    {
      id: "d242-phys", level: "phys", difficulty: 1,
      title: "August review: what did the buying pause teach you?",
      why: "Notice what you didn't miss and how your spending changed. Keep the lessons that fit your life."
    },
    {
      id: "d243-phys", level: "phys", difficulty: 1,
      title: "Set up one morning station for everything you need to leave the house",
      why: "A single spot for keys, bag and daily items turns the morning rush into a routine."
    },
    /* ===== PHYSICAL — DAYS 244–273 · SEPTEMBER · Routines & workspace ===== */
    {
      id: "d244-phys", level: "phys", difficulty: 2,
      title: "Clear your desk completely; return only what you use every day",
      why: "A clear desk supports focused work. Everything else can live in a drawer or leave."
    },
    {
      id: "d245-phys", level: "phys", difficulty: 1,
      title: "Keep one of each office supply you need; donate the extras",
      why: "Twenty paper clips are enough. Extras belong to someone who needs them now."
    },
    {
      id: "d246-phys", level: "phys", difficulty: 1,
      title: "Before buying school or work supplies, check what you already have",
      why: "Most homes have enough pens, notebooks and folders for a whole year. Shop from your drawers first."
    },
    {
      id: "d247-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear the desk at the end of each workday",
      why: "Ending the day with a clear desk makes the next morning's start easier."
    },
    {
      id: "d248-phys", level: "phys", difficulty: 2,
      title: "Organize the cables you keep: label and store them by type",
      why: "Knowing which cable is which saves time and prevents buying duplicates."
    },
    {
      id: "d249-phys", level: "phys", difficulty: 1,
      title: "Pack your work or school bag with only what you need daily",
      why: "A heavy bag carried every day is a burden on your back and your focus."
    },
    {
      id: "d250-phys", level: "phys", difficulty: 1,
      title: "Put together a reusable lunch kit: container, cutlery, bottle",
      why: "A simple kit replaces daily disposables and makes bringing food from home easier."
    },
    {
      id: "d251-phys", level: "phys", difficulty: 1,
      title: "Set up one inbox tray for incoming paper on your desk",
      why: "One tray catches everything until you process it, instead of piles spreading across the desk."
    },
    {
      id: "d252-phys", level: "phys", difficulty: 2,
      title: "Ask yourself if you really need a home printer",
      why: "Printers take space and ink costs add up. For occasional printing, a local print shop may be enough."
    },
    {
      id: "d253-phys", level: "phys", difficulty: 2,
      title: "Pass on textbooks and course materials you won't use again",
      why: "Students and libraries often welcome them. Your old books could save someone money this year."
    },
    {
      id: "d254-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: process the paper in your inbox tray",
      why: "A tray only works if it's emptied. Once a week, act, file or recycle everything in it."
    },
    {
      id: "d255-phys", level: "phys", difficulty: 1,
      title: "Clear the space around your keyboard and screen",
      why: "A cleared workspace reduces distractions and makes good posture easier."
    },
    {
      id: "d256-phys", level: "phys", difficulty: 1,
      title: "Choose one planning tool for the household: wall calendar or whiteboard",
      why: "Multiple planners compete; one shared tool keeps everyone in sync."
    },
    {
      id: "d257-phys", level: "phys", difficulty: 1,
      title: "Clear the hallway coat rack before autumn",
      why: "Summer jackets and bags pile up by the door. Make room for what the new season needs."
    },
    {
      id: "d258-phys", level: "phys", difficulty: 2,
      title: "Pass on clothes that you or your family have outgrown",
      why: "Outgrown clothes are best used now, by someone who fits them today."
    },
    {
      id: "d259-phys", level: "phys", difficulty: 1,
      title: "Keep one matching set of meal-prep containers",
      why: "A consistent set stacks neatly and makes weekly cooking easier."
    },
    {
      id: "d260-phys", level: "phys", difficulty: 2,
      title: "Deep clean the oven and stovetop",
      why: "A clean oven is a quiet pleasure and makes cooking more inviting as the weather cools."
    },
    {
      id: "d261-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: tidy the living room",
      why: "The living room is where the household gathers. Keeping it clear keeps it inviting."
    },
    {
      id: "d262-phys", level: "phys", difficulty: 1,
      title: "Check your rain gear before autumn: one umbrella, one raincoat, one pair of boots",
      why: "It's better to know now what works than on the first rainy day."
    },
    {
      id: "d263-phys", level: "phys", difficulty: 1,
      title: "If you work from home, pack work items away at the end of the day",
      why: "A visible laptop keeps work present in the evening. Putting it away draws a clear line."
    },
    {
      id: "d264-phys", level: "phys", difficulty: 1,
      title: "Review physical subscriptions: magazines, boxes, deliveries",
      why: "Recurring deliveries bring in things automatically. Keep only those you truly look forward to."
    },
    {
      id: "d265-phys", level: "phys", difficulty: 1,
      title: "Set fixed laundry days to prevent piles",
      why: "A regular rhythm keeps laundry from becoming a mountain on a chair."
    },
    {
      id: "d266-phys", level: "phys", difficulty: 1,
      title: "Check the shoe rack before autumn; store summer pairs",
      why: "Seasonal switching keeps the rack usable and shows what needs repair."
    },
    {
      id: "d267-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes, one bag out",
      why: "A steady rhythm of small exits keeps your home lighter week after week."
    },
    {
      id: "d268-phys", level: "phys", difficulty: 1,
      title: "Clear the kitchen table so it can be the household's calm center",
      why: "A clear table is where plans are made and meals are shared. Keep it free of piles."
    },
    {
      id: "d269-phys", level: "phys", difficulty: 2,
      title: "Replace one worn-out essential with a high-quality version",
      why: "Minimalism isn't deprivation. Investing in one item you use daily improves life every day."
    },
    {
      id: "d270-phys", level: "phys", difficulty: 1,
      title: "Test your smoke detector and replace its battery if needed",
      why: "Minimalism is about what matters, and safety matters most. A working detector is one of the few items every home truly needs."
    },
    {
      id: "d271-phys", level: "phys", difficulty: 2,
      title: "Re-check the bathroom cabinet: summer products that are finished or expired",
      why: "Sun lotions, after-sun and travel minis collect over summer. Clear them before the new season."
    },
    {
      id: "d272-phys", level: "phys", difficulty: 1,
      title: "September review: which new routine helped you most?",
      why: "Routines keep a home tidy with little effort. Notice which one you want to keep."
    },
    {
      id: "d273-phys", level: "phys", difficulty: 1,
      title: "Plan your autumn capsule: what did the summer one teach you?",
      why: "Each capsule is an experiment. Take the lessons from the last one into the next."
    },
    /* ===== PHYSICAL — DAYS 274–304 · OCTOBER · Autumn & memories ===== */
    {
      id: "d274-phys", level: "phys", difficulty: 3,
      title: "Start your autumn capsule: choose 33 items for the next three months",
      why: "A new season is a natural reset. Choose pieces that layer well and store the rest out of sight."
    },
    {
      id: "d275-phys", level: "phys", difficulty: 2,
      title: "Store summer clothes and let go of any you didn't wear this summer",
      why: "If it stayed on the hanger all season, it probably will next year too."
    },
    {
      id: "d276-phys", level: "phys", difficulty: 1,
      title: "Bring out clean autumn bedding and a few cozy blankets",
      why: "Seasonal switching keeps closets lighter. Only what you need now needs to be within reach."
    },
    {
      id: "d277-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes putting everything back in its place",
      why: "The autumn rhythm starts here. Small weekly resets carry you through the busy months ahead."
    },
    {
      id: "d278-phys", level: "phys", difficulty: 2,
      title: "Gather all printed photos from around the house into one box",
      why: "Photos scattered in drawers and envelopes are rarely enjoyed. Seeing them together is the first step."
    },
    {
      id: "d279-phys", level: "phys", difficulty: 1,
      title: "Remove duplicate, blurry and meaningless photo prints",
      why: "Not every print deserves a place. Removing the obvious ones makes the rest easier to enjoy."
    },
    {
      id: "d280-phys", level: "phys", difficulty: 2,
      title: "Choose your favorite prints for one album; scan the rest you want to keep",
      why: "An album you open is worth more than boxes you don't. Scans protect memories from loss."
    },
    {
      id: "d281-phys", level: "phys", difficulty: 1,
      title: "Refresh your photo frames: new favorites in, or empty frames out",
      why: "Frames with outdated photos fade into the background. Fresh images bring them back to life."
    },
    {
      id: "d282-phys", level: "phys", difficulty: 2,
      title: "Review awards, trophies and certificates; keep the meaningful ones",
      why: "The achievement is yours whether or not the object stays. Photograph the rest before letting go."
    },
    {
      id: "d283-phys", level: "phys", difficulty: 3,
      title: "Look at inherited items: keep only what you would have chosen yourself",
      why: "Honoring a loved one doesn't require keeping everything they owned. One treasured piece can hold the whole memory."
    },
    {
      id: "d284-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear one surface in each room",
      why: "Surfaces collect during busy weeks. A quick sweep keeps the calm you've built."
    },
    {
      id: "d285-phys", level: "phys", difficulty: 1,
      title: "Sort tickets, programs and event memorabilia",
      why: "Keep a few that spark strong memories; a photo can hold the rest."
    },
    {
      id: "d286-phys", level: "phys", difficulty: 2,
      title: "Give your memories one box with a fixed size",
      why: "A limit makes you choose, and choosing makes each item more precious."
    },
    {
      id: "d287-phys", level: "phys", difficulty: 2,
      title: "Review items from special occasions: invitations, decorations, favors",
      why: "Keep one meaningful piece from each occasion; the rest have done their job."
    },
    {
      id: "d288-phys", level: "phys", difficulty: 1,
      title: "Use the 'good' dishes or glasses you've been saving for a special day",
      why: "Items saved for special occasions often never get used. Everyday life deserves beautiful things too."
    },
    {
      id: "d289-phys", level: "phys", difficulty: 1,
      title: "Sort yearbooks and old hobby memorabilia",
      why: "Keep what brings joy when you open it. If you never open it, reconsider."
    },
    {
      id: "d290-phys", level: "phys", difficulty: 1,
      title: "Before donating family items, ask relatives if they'd like them",
      why: "Someone else in the family may treasure what you don't need. Asking first avoids regret."
    },
    {
      id: "d291-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: return sentimental items you've sorted to their final place",
      why: "Decisions only feel finished when items are stored or gone. Close the loop."
    },
    {
      id: "d292-phys", level: "phys", difficulty: 2,
      title: "Before the heating season, clear the space around radiators and heaters",
      why: "Items near heat sources are a fire risk and block warmth from reaching the room."
    },
    {
      id: "d293-phys", level: "phys", difficulty: 1,
      title: "Keep a few cozy blankets and donate the extras to an animal shelter",
      why: "Cold nights call for comfort, not stockpiles. Shelters welcome warm textiles."
    },
    {
      id: "d294-phys", level: "phys", difficulty: 1,
      title: "Refresh the pantry for autumn: use up summer leftovers first",
      why: "Seasonal cooking uses fresh produce and reduces stockpiles."
    },
    {
      id: "d295-phys", level: "phys", difficulty: 1,
      title: "Check winter shoes and boots; repair before you need them",
      why: "Repairs take time. Taking shoes to the cobbler now avoids buying new ones in a hurry."
    },
    {
      id: "d296-phys", level: "phys", difficulty: 1,
      title: "Pair gloves, scarves and hats; let go of single gloves",
      why: "Winter accessories get scattered. Complete sets are easy to grab on a cold morning."
    },
    {
      id: "d297-phys", level: "phys", difficulty: 1,
      title: "Check your coats: keep the ones that are warm and that you wear",
      why: "Coats take up a lot of space. One or two good ones are enough for most climates."
    },
    {
      id: "d298-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes in the entrance",
      why: "Autumn brings coats, umbrellas and wet shoes. A quick reset keeps the entrance welcoming."
    },
    {
      id: "d299-phys", level: "phys", difficulty: 1,
      title: "Write down the story behind the sentimental items you keep",
      why: "The story is what makes an object precious. Written down, it can be passed on even when the object can't."
    },
    {
      id: "d300-phys", level: "phys", difficulty: 1,
      title: "Day 300: walk through your home. What still feels heavy?",
      why: "After three hundred days, your eye is trained. Trust it to spot what's left."
    },
    {
      id: "d301-phys", level: "phys", difficulty: 3,
      title: "Do a second pass on your storage room or basement",
      why: "Your standards have changed since spring. Items you kept then may be easy to release now."
    },
    {
      id: "d302-phys", level: "phys", difficulty: 2,
      title: "Second pass in the kitchen: which tools haven't you used since spring?",
      why: "Six months is a fair test. If you didn't need it, it's likely you won't."
    },
    {
      id: "d303-phys", level: "phys", difficulty: 1,
      title: "Second pass on your bookshelf: which books did you keep but not open?",
      why: "Your reading life has moved on. Let books you won't read find new readers."
    },
    {
      id: "d304-phys", level: "phys", difficulty: 1,
      title: "October review: what did sorting memories teach you?",
      why: "Sentimental items reveal what we value most. Notice what you chose to keep."
    },
    /* ===== PHYSICAL — DAYS 305–334 · NOVEMBER · Mindful holidays prep ===== */
    {
      id: "d305-phys", level: "phys", difficulty: 2,
      title: "Suggest a simpler gift exchange to family or friends, like a secret Santa",
      why: "Fewer, more thoughtful gifts reduce stress, cost and clutter for everyone."
    },
    {
      id: "d306-phys", level: "phys", difficulty: 1,
      title: "Make a gift list focused on experiences and consumables",
      why: "Tickets, lessons, good food or time together are gifts that don't add clutter."
    },
    {
      id: "d307-phys", level: "phys", difficulty: 2,
      title: "Check your holiday decorations now: keep what you love, pass on the rest",
      why: "Deciding before the season avoids buying new decorations on top of forgotten ones."
    },
    {
      id: "d308-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: one room, 10 minutes, everything in its place",
      why: "The season is getting busier. Protect the calm with small, steady actions."
    },
    {
      id: "d309-phys", level: "phys", difficulty: 2,
      title: "Clear space in the kitchen for holiday cooking",
      why: "Big meals need free counters and cupboards. Preparing now makes the season smoother."
    },
    {
      id: "d310-phys", level: "phys", difficulty: 1,
      title: "Need more plates or chairs for guests? Borrow instead of buying",
      why: "Items bought for one dinner often sit unused all year. Friends and family can lend."
    },
    {
      id: "d311-phys", level: "phys", difficulty: 1,
      title: "Plan to wrap gifts with what you already have, or in reusable fabric",
      why: "Wrapping paper is used for seconds. Fabric, scarves or reused paper look beautiful and waste less."
    },
    {
      id: "d312-phys", level: "phys", difficulty: 1,
      title: "Choose one handmade or homemade gift idea",
      why: "Homemade gifts, like cookies, jam or a letter, carry meaning without adding clutter."
    },
    {
      id: "d313-phys", level: "phys", difficulty: 2,
      title: "Donate a warm coat you don't wear to someone who needs it",
      why: "Winter is when warm clothing matters most. Many organizations collect coats this time of year."
    },
    {
      id: "d314-phys", level: "phys", difficulty: 1,
      title: "Before the big sales, write down the only things you really need",
      why: "Sales are designed to make everything feel urgent. A list decided in advance protects your budget and your space."
    },
    {
      id: "d315-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear the dining table and entrance",
      why: "Guests and gatherings start to fill the calendar. Keep the shared spaces ready."
    },
    {
      id: "d316-phys", level: "phys", difficulty: 2,
      title: "Prepare a clear, welcoming space for holiday visitors",
      why: "A guest area without piles makes visitors feel expected and at ease."
    },
    {
      id: "d317-phys", level: "phys", difficulty: 2,
      title: "If you live with children, donate some toys together before the holidays",
      why: "Choosing toys to give away teaches generosity and makes room for what's coming."
    },
    {
      id: "d318-phys", level: "phys", difficulty: 1,
      title: "Donate pantry surplus to a food bank or social grocery",
      why: "Extra cans and packages can become someone's holiday meal."
    },
    {
      id: "d319-phys", level: "phys", difficulty: 1,
      title: "Buy in bulk only what you use steadily",
      why: "Bulk deals save money only if you use everything before it expires or clutters your storage."
    },
    {
      id: "d320-phys", level: "phys", difficulty: 1,
      title: "Check your stash of 'spare gifts' and use or donate them",
      why: "Gifts bought 'just in case' are often forgotten. Give them purposefully now."
    },
    {
      id: "d321-phys", level: "phys", difficulty: 1,
      title: "Clear out the fridge before holiday cooking begins",
      why: "A clean, half-empty fridge has room for holiday dishes and leftovers."
    },
    {
      id: "d322-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: clear the kitchen for the holiday weeks",
      why: "Holiday preparations make the kitchen the heart of the home. Keep it clear and ready."
    },
    {
      id: "d323-phys", level: "phys", difficulty: 1,
      title: "Prepare clean sheets and towels for guests",
      why: "One complete set per guest bed is enough. No need to buy new."
    },
    {
      id: "d324-phys", level: "phys", difficulty: 1,
      title: "Make room at the entrance for guests' coats and shoes",
      why: "A clear entrance makes arrivals easy and shows care before anyone sits down."
    },
    {
      id: "d325-phys", level: "phys", difficulty: 1,
      title: "Return or exchange unopened purchases while you still can",
      why: "Return windows close quietly. Acting now recovers money and space."
    },
    {
      id: "d326-phys", level: "phys", difficulty: 1,
      title: "Plan one experience gift for someone you love",
      why: "Shared experiences tend to be remembered longer than objects."
    },
    {
      id: "d327-phys", level: "phys", difficulty: 3,
      title: "Declutter one full room before the holiday season",
      why: "A calm room gives you a retreat during the busiest weeks of the year."
    },
    {
      id: "d328-phys", level: "phys", difficulty: 1,
      title: "Prepare an empty donation box for things that will be replaced by gifts",
      why: "When new things arrive, older ones have a ready exit."
    },
    {
      id: "d329-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: one bag out before the holidays",
      why: "Starting the season lighter makes room for the people and moments that matter."
    },
    {
      id: "d330-phys", level: "phys", difficulty: 1,
      title: "Sales week: buy only what's on your list",
      why: "Every 'deal' outside your list is still money spent and space used."
    },
    {
      id: "d331-phys", level: "phys", difficulty: 1,
      title: "Spend one day buying nothing and doing something free you enjoy",
      why: "A day without shopping reminds you how little consumption has to do with a good day."
    },
    {
      id: "d332-phys", level: "phys", difficulty: 1,
      title: "If you bought something new, let one similar item go",
      why: "One in, one out keeps the balance, even during the sales."
    },
    {
      id: "d333-phys", level: "phys", difficulty: 1,
      title: "Review this month's purchases: which ones do you already regret?",
      why: "Recognizing regret early helps you return items and shop more carefully next time."
    },
    {
      id: "d334-phys", level: "phys", difficulty: 1,
      title: "November review: how did you handle the pressure to buy?",
      why: "Every season of sales is practice. Notice what helped you stay on track."
    },
    /* ===== PHYSICAL — DAYS 335–365 · DECEMBER · Holidays & year review ===== */
    {
      id: "d335-phys", level: "phys", difficulty: 2,
      title: "Decorate with less: display only your favorite decorations",
      why: "A few meaningful decorations create more atmosphere than every box emptied onto every surface."
    },
    {
      id: "d336-phys", level: "phys", difficulty: 1,
      title: "Add natural decorations: branches, pine cones, dried oranges",
      why: "Natural decor is beautiful, cheap and can be composted after the season."
    },
    {
      id: "d337-phys", level: "phys", difficulty: 2,
      title: "Reverse advent: put one item into a donation box every day this month",
      why: "Giving daily builds a generous rhythm and a full box by the end of December."
    },
    {
      id: "d338-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: tidy up before the week's gatherings",
      why: "A quick reset before guests arrive makes hosting relaxed rather than rushed."
    },
    {
      id: "d339-phys", level: "phys", difficulty: 1,
      title: "Wrap your gifts using reusable fabric, boxes or paper you already have",
      why: "Beautiful wrapping doesn't need to end up in the bin."
    },
    {
      id: "d340-phys", level: "phys", difficulty: 1,
      title: "Choose gifts people will use up or experience",
      why: "Consumable and experience gifts give joy without long-term storage."
    },
    {
      id: "d341-phys", level: "phys", difficulty: 2,
      title: "Donate toys, clothes or food to a holiday charity drive",
      why: "The holidays are when many people need a little help. What you don't need can matter a lot to someone else."
    },
    {
      id: "d342-phys", level: "phys", difficulty: 1,
      title: "Send fewer, more personal holiday cards",
      why: "A few heartfelt words mean more than a stack of generic cards."
    },
    {
      id: "d343-phys", level: "phys", difficulty: 1,
      title: "Do a 15-minute reset before guests arrive",
      why: "Clear surfaces and a clear entrance are all you need to welcome people warmly."
    },
    {
      id: "d344-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes wherever the celebrations left their mark",
      why: "Short resets keep the festive season joyful instead of overwhelming."
    },
    {
      id: "d345-phys", level: "phys", difficulty: 1,
      title: "Plan holiday meals to avoid food waste",
      why: "Cook for the number of people you'll really have. Abundance doesn't need to end in the bin."
    },
    {
      id: "d346-phys", level: "phys", difficulty: 1,
      title: "Make a plan for leftovers: share, freeze or cook them into new meals",
      why: "Leftovers are a gift if you plan for them. Send some home with guests."
    },
    {
      id: "d347-phys", level: "phys", difficulty: 1,
      title: "Accept gifts graciously; you can decide what to keep later",
      why: "Receiving is about the relationship, not the object. Decisions can wait until after the holidays."
    },
    {
      id: "d348-phys", level: "phys", difficulty: 2,
      title: "For each new gift you keep, let one older item go",
      why: "New arrivals are the perfect moment to release what they replace."
    },
    {
      id: "d349-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: return the house to calm after the celebrations",
      why: "After the peak of the season, a reset helps you rest."
    },
    {
      id: "d350-phys", level: "phys", difficulty: 1,
      title: "Spend an evening by candlelight with no screens and no errands",
      why: "A calm home is best enjoyed slowly. Let the simple evening be the celebration."
    },
    {
      id: "d351-phys", level: "phys", difficulty: 2,
      title: "Store decorations compactly and let broken ones go",
      why: "Pack away only what you'll happily use next year, clearly labeled."
    },
    {
      id: "d352-phys", level: "phys", difficulty: 1,
      title: "Recycle wrapping, boxes and packaging right away",
      why: "Packaging piles up fast after the holidays. Clear it before it becomes part of the furniture."
    },
    {
      id: "d353-phys", level: "phys", difficulty: 2,
      title: "Year-end donation run: take everything in your donation box",
      why: "Ending the year with nothing waiting to leave is a clean slate for January."
    },
    {
      id: "d354-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: 10 minutes to close the year",
      why: "One last small ritual before the new year begins."
    },
    {
      id: "d355-phys", level: "phys", difficulty: 2,
      title: "Do a final paper sweep before the new year",
      why: "Process the last bills and papers of the year so January starts clear."
    },
    {
      id: "d356-phys", level: "phys", difficulty: 1,
      title: "Gather this year's important receipts in one folder for your taxes",
      why: "Tax season is easier when everything is already in one place."
    },
    {
      id: "d357-phys", level: "phys", difficulty: 2,
      title: "Photograph each room and compare with how it looked a year ago",
      why: "A year of daily steps adds up to something you can see. Take a moment to appreciate it."
    },
    {
      id: "d358-phys", level: "phys", difficulty: 1,
      title: "List five things you let go of this year and don't miss at all",
      why: "Not missing them is the proof. Remember that next time a decision feels hard."
    },
    {
      id: "d359-phys", level: "phys", difficulty: 1,
      title: "Write down the habits you want to keep next year",
      why: "The habits are what keep a home light. Choose the few that worked best for you."
    },
    {
      id: "d360-phys", level: "phys", difficulty: 1,
      title: "Weekly reset: a calm home for the last days of the year",
      why: "Enjoy the space you've created. It's ready for whatever comes next."
    },
    {
      id: "d361-phys", level: "phys", difficulty: 1,
      title: "Choose the one space you want to focus on next year",
      why: "Just as in January, a clear first target makes the new year easier to start."
    },
    {
      id: "d362-phys", level: "phys", difficulty: 2,
      title: "Give the entrance a deep clean to welcome the new year",
      why: "Many traditions clean the home before the new year. A fresh entrance is a warm welcome."
    },
    {
      id: "d363-phys", level: "phys", difficulty: 1,
      title: "Clear the fridge to make room for New Year's Eve",
      why: "Using up what's there before the feast avoids waste and makes room for celebration."
    },
    {
      id: "d364-phys", level: "phys", difficulty: 1,
      title: "Come full circle: clear one drawer completely, just like Day 1",
      why: "The same small act feels different after a year of practice. Notice how easy it has become."
    },
    {
      id: "d365-phys", level: "phys", difficulty: 1,
      title: "Thank your home: walk through it and notice what you love",
      why: "Minimalism was never about emptiness. It was about making room for what matters. Enjoy it."
    },
    /* ===== DIGITAL — DAYS 1–31 · JANUARY · Phone & notifications ===== */
    {
      id: "d1-dig", level: "dig", difficulty: 1,
      title: "Turn off notifications for one app that never has anything urgent",
      why: "Every notification is an interruption someone else chose for you. Starting with one app shows how little you miss."
    },
    {
      id: "d2-dig", level: "dig", difficulty: 1,
      title: "Delete apps you haven't opened in the last month",
      why: "Unused apps take storage, send notifications and may collect data in the background. You can always reinstall."
    },
    {
      id: "d3-dig", level: "dig", difficulty: 2,
      title: "Reduce your home screen to one page of useful tools",
      why: "Your home screen is what you see dozens of times a day. Tools like maps and calendar belong there; endless feeds don't."
    },
    {
      id: "d4-dig", level: "dig", difficulty: 1,
      title: "Move social media apps off your home screen into a folder",
      why: "A little friction goes a long way. Having to search for an app turns an automatic habit into a conscious choice."
    },
    {
      id: "d5-dig", level: "dig", difficulty: 1,
      title: "Open your screen time report and note your top three apps",
      why: "You can't change what you don't measure. The numbers are often surprising."
    },
    {
      id: "d6-dig", level: "dig", difficulty: 1,
      title: "Schedule a night-time Do Not Disturb or Focus mode",
      why: "Your sleep deserves protection. Let calls from favorites through and silence the rest."
    },
    {
      id: "d7-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: roughly how often did you pick up your phone this week?",
      why: "Many phones count pickups. Awareness alone often reduces the number."
    },
    {
      id: "d8-dig", level: "dig", difficulty: 1,
      title: "Turn off red notification badges for non-essential apps",
      why: "Red dots are designed to create a sense of unfinished business. Removing them removes the itch."
    },
    {
      id: "d9-dig", level: "dig", difficulty: 1,
      title: "Try grayscale mode on your phone for one day",
      why: "Color makes screens more appealing. In grayscale, the phone becomes a tool rather than a slot machine."
    },
    {
      id: "d10-dig", level: "dig", difficulty: 2,
      title: "Charge your phone outside the bedroom tonight",
      why: "Without the phone within reach, both falling asleep and waking up become calmer."
    },
    {
      id: "d11-dig", level: "dig", difficulty: 1,
      title: "Use a simple alarm clock instead of your phone",
      why: "If the phone is your alarm, it's also the first thing you check. A separate clock breaks that link."
    },
    {
      id: "d12-dig", level: "dig", difficulty: 1,
      title: "Hide message previews on your lock screen for noisy apps",
      why: "Previews pull you in before you decide to engage. Hiding them gives you back the choice, and protects privacy."
    },
    {
      id: "d13-dig", level: "dig", difficulty: 1,
      title: "Mute group chats that are rarely urgent",
      why: "You can still read them when you choose. Muting turns a stream of pings into something you check on your terms."
    },
    {
      id: "d14-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which change this week felt best?",
      why: "Noticing what works makes it easier to keep. Build on what already feels good."
    },
    {
      id: "d15-dig", level: "dig", difficulty: 2,
      title: "Delete one game you play compulsively rather than joyfully",
      why: "Some games are designed to keep you returning, not to entertain. If it feels like a habit rather than fun, let it go."
    },
    {
      id: "d16-dig", level: "dig", difficulty: 2,
      title: "Replace one app with its website version",
      why: "Browsers add a little friction and fewer notifications. You still have access, just less pull."
    },
    {
      id: "d17-dig", level: "dig", difficulty: 3,
      title: "Remove one social media app from your phone for a week",
      why: "A week is long enough to notice the difference and short enough to feel doable. You can still visit from a computer."
    },
    {
      id: "d18-dig", level: "dig", difficulty: 1,
      title: "Set a daily time limit for your most-used app",
      why: "A limit you set in a calm moment helps in the moments when willpower is low."
    },
    {
      id: "d19-dig", level: "dig", difficulty: 2,
      title: "Spend the first 30 minutes of your day without your phone",
      why: "The first thing you look at sets the tone. Start with your own thoughts instead of everyone else's."
    },
    {
      id: "d20-dig", level: "dig", difficulty: 2,
      title: "Spend the last 30 minutes before bed without screens",
      why: "Screens stimulate the mind when it should be winding down. Read, stretch or talk instead."
    },
    {
      id: "d21-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: compare your screen time with last week",
      why: "Trends matter more than single days. Celebrate any direction toward less."
    },
    {
      id: "d22-dig", level: "dig", difficulty: 1,
      title: "Remove home screen widgets you don't actually use",
      why: "Widgets constantly display information you didn't ask for. Keep only the ones that save you time."
    },
    {
      id: "d23-dig", level: "dig", difficulty: 1,
      title: "Choose a calm, simple wallpaper",
      why: "A busy background makes a busy screen. A calm one is a small daily breath."
    },
    {
      id: "d24-dig", level: "dig", difficulty: 1,
      title: "Turn off autoplay in your video apps",
      why: "Autoplay decides for you when an episode ends. Without it, you choose whether to continue."
    },
    {
      id: "d25-dig", level: "dig", difficulty: 1,
      title: "Turn off vibration for non-essential notifications",
      why: "Vibrations are felt even when ignored. Keep them only for people and things that matter."
    },
    {
      id: "d26-dig", level: "dig", difficulty: 1,
      title: "Eat one meal today with no phone on the table",
      why: "A phone on the table, even face down, divides attention. Meals are better when you're fully there."
    },
    {
      id: "d27-dig", level: "dig", difficulty: 2,
      title: "Leave your phone at home for a short walk",
      why: "Remember how it feels to be unreachable for twenty minutes. The world will wait."
    },
    {
      id: "d28-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which app do you reach for when you're bored?",
      why: "Knowing your default escape helps you choose a better one, or simply sit with the moment."
    },
    {
      id: "d29-dig", level: "dig", difficulty: 2,
      title: "Review which apps may send notifications; group the rest into a scheduled summary",
      why: "Many phones can bundle non-urgent notifications into a digest at set times. Fewer interruptions, same information."
    },
    {
      id: "d30-dig", level: "dig", difficulty: 1,
      title: "Clear old voicemails and your call history",
      why: "Old voicemails are forgotten to-dos. Listen, act or delete."
    },
    {
      id: "d31-dig", level: "dig", difficulty: 1,
      title: "January review: compare this week's screen time with the first week of the month",
      why: "A month of small changes can shift your habits noticeably. Write down what you want to keep."
    },
    /* ===== DIGITAL — DAYS 32–59 · FEBRUARY · Email ===== */
    {
      id: "d32-dig", level: "dig", difficulty: 1,
      title: "Note how many unread emails you have, without judging",
      why: "A number gives a starting point. This month, your inbox becomes a tool rather than a weight."
    },
    {
      id: "d33-dig", level: "dig", difficulty: 2,
      title: "Unsubscribe from ten newsletters you no longer read",
      why: "Each unsubscribe is a small decision that pays off every week. Use the link at the bottom of the email."
    },
    {
      id: "d34-dig", level: "dig", difficulty: 3,
      title: "Archive every email older than 30 days in one go",
      why: "If something old were truly urgent, you'd know by now. Archived emails remain searchable; your inbox starts fresh."
    },
    {
      id: "d35-dig", level: "dig", difficulty: 1,
      title: "Keep your email folders or labels to a handful",
      why: "Complex folder systems take more time than they save. Search does most of the work."
    },
    {
      id: "d36-dig", level: "dig", difficulty: 2,
      title: "Create a filter that sends receipts and order confirmations to one folder",
      why: "Receipts are worth keeping but not worth seeing. Filters keep them findable and out of the way."
    },
    {
      id: "d37-dig", level: "dig", difficulty: 1,
      title: "Turn off email notifications on your phone",
      why: "Email is rarely urgent. Checking it when you choose protects your focus."
    },
    {
      id: "d38-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how many emails arrived this week that you didn't need?",
      why: "Each unneeded email is a candidate for an unsubscribe or a filter."
    },
    {
      id: "d39-dig", level: "dig", difficulty: 2,
      title: "Check email at two or three set times today instead of constantly",
      why: "Batching email turns dozens of interruptions into a few focused sessions."
    },
    {
      id: "d40-dig", level: "dig", difficulty: 1,
      title: "Answer immediately any email that takes less than two minutes",
      why: "Short replies left for later take more energy to remember than to write."
    },
    {
      id: "d41-dig", level: "dig", difficulty: 2,
      title: "Find and delete emails with large attachments you no longer need",
      why: "Old attachments take up most of the space in a mailbox. Save what matters to your files first."
    },
    {
      id: "d42-dig", level: "dig", difficulty: 1,
      title: "Turn off email notifications from social networks",
      why: "Social networks email you to bring you back. You'll see the updates when you choose to visit."
    },
    {
      id: "d43-dig", level: "dig", difficulty: 1,
      title: "Simplify your email signature",
      why: "A short signature with just the essentials looks more professional than a long one with banners."
    },
    {
      id: "d44-dig", level: "dig", difficulty: 1,
      title: "Empty your email drafts folder",
      why: "Drafts are unfinished decisions. Send what matters, delete the rest."
    },
    {
      id: "d45-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how does your inbox feel compared to the start of the month?",
      why: "Notice the difference in both numbers and feelings. That's the real measure."
    },
    {
      id: "d46-dig", level: "dig", difficulty: 1,
      title: "Write shorter emails: aim for five sentences or fewer",
      why: "Short emails are read faster and answered sooner. Brevity respects everyone's time."
    },
    {
      id: "d47-dig", level: "dig", difficulty: 1,
      title: "Ask to be removed from email threads you don't need to follow",
      why: "Being copied 'just in case' fills your inbox with other people's conversations."
    },
    {
      id: "d48-dig", level: "dig", difficulty: 3,
      title: "Consolidate your email: stop using one old address and forward it to your main one",
      why: "Each extra account is another inbox to check. Forwarding keeps you reachable while simplifying."
    },
    {
      id: "d49-dig", level: "dig", difficulty: 1,
      title: "Check your spam folder for anything important, then empty it",
      why: "A quick look prevents missed messages; emptying it removes old clutter."
    },
    {
      id: "d50-dig", level: "dig", difficulty: 1,
      title: "Save templates for the replies you write most often",
      why: "Repeated answers don't need to be rewritten. Templates save time without losing warmth."
    },
    {
      id: "d51-dig", level: "dig", difficulty: 2,
      title: "Clean up your contacts: merge duplicates, delete numbers you don't recognize",
      why: "A clean contact list makes finding people fast and keeps your phone's address book trustworthy."
    },
    {
      id: "d52-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which email habit is sticking?",
      why: "Habits stick when they're simple. Keep the one that works and drop the one that doesn't."
    },
    {
      id: "d53-dig", level: "dig", difficulty: 1,
      title: "Remind yourself that not every message needs an instant reply",
      why: "Instant replies train others to expect them. A thoughtful reply a few hours later is usually better."
    },
    {
      id: "d54-dig", level: "dig", difficulty: 1,
      title: "Rely on search instead of filing every email carefully",
      why: "Modern search is fast and accurate. Archive freely and search when needed."
    },
    {
      id: "d55-dig", level: "dig", difficulty: 1,
      title: "Keep only the newsletters you actually look forward to",
      why: "A few good newsletters are a pleasure. Dozens are a chore."
    },
    {
      id: "d56-dig", level: "dig", difficulty: 2,
      title: "Reply to one email that has been waiting too long",
      why: "A long-pending reply weighs more every day. Sending it, even briefly, lifts the weight."
    },
    {
      id: "d57-dig", level: "dig", difficulty: 1,
      title: "Consider turning off read receipts and typing indicators if they create pressure",
      why: "Being seen as 'online' or 'read' can make you feel obliged to reply at once. You decide the pace."
    },
    {
      id: "d58-dig", level: "dig", difficulty: 1,
      title: "Archive old chats in your messaging apps",
      why: "Finished conversations don't need to sit at the top. Archived chats are still there if you need them."
    },
    {
      id: "d59-dig", level: "dig", difficulty: 1,
      title: "February review: compare your unread count with the start of the month",
      why: "A calmer inbox is one of the most noticeable digital wins. Keep the habits that got you here."
    },
    /* ===== DIGITAL — DAYS 60–90 · MARCH · Files & cloud ===== */
    {
      id: "d60-dig", level: "dig", difficulty: 2,
      title: "Clear your computer desktop: move everything into one folder",
      why: "A cluttered desktop is visual noise every time you open your computer. Start clean and sort later."
    },
    {
      id: "d61-dig", level: "dig", difficulty: 2,
      title: "Sort your Downloads folder: keep, move or delete",
      why: "Downloads is where files go to be forgotten. Deal with what matters and delete the rest."
    },
    {
      id: "d62-dig", level: "dig", difficulty: 2,
      title: "Uninstall programs on your computer that you no longer use",
      why: "Unused software takes space, slows startup and may carry unpatched security holes."
    },
    {
      id: "d63-dig", level: "dig", difficulty: 2,
      title: "Simplify your folder structure to a few top-level folders",
      why: "Deep, complex folder trees make files hard to find. A few clear categories are easier to maintain."
    },
    {
      id: "d64-dig", level: "dig", difficulty: 1,
      title: "Rename ten files with clear names, starting with the date (YYYY-MM-DD)",
      why: "Dates at the start sort files in order automatically. Clear names make search work."
    },
    {
      id: "d65-dig", level: "dig", difficulty: 2,
      title: "Find and delete duplicate files",
      why: "Duplicates waste space and create confusion about which version is current."
    },
    {
      id: "d66-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how long does it take you to find a file you need?",
      why: "Fast retrieval is the goal of any file system. If it's slow, simplify further."
    },
    {
      id: "d67-dig", level: "dig", difficulty: 1,
      title: "Empty the trash or recycle bin on your computer",
      why: "Deleted files still take up space until the bin is emptied."
    },
    {
      id: "d68-dig", level: "dig", difficulty: 2,
      title: "Check what's using the most space in your cloud storage",
      why: "Often a few large files or old backups take most of the space. Removing them may save you a paid plan."
    },
    {
      id: "d69-dig", level: "dig", difficulty: 3,
      title: "Choose one main cloud service and move files from the others into it",
      why: "Files spread across several services are hard to find and easy to lose. One home for your files simplifies everything."
    },
    {
      id: "d70-dig", level: "dig", difficulty: 2,
      title: "Review shared links and folders; remove access that's no longer needed",
      why: "Old shared links can expose files to people you no longer work with."
    },
    {
      id: "d71-dig", level: "dig", difficulty: 1,
      title: "Clear out your screenshots folder",
      why: "Screenshots are taken for a moment and kept for years. Delete the ones that have done their job."
    },
    {
      id: "d72-dig", level: "dig", difficulty: 1,
      title: "Check your phone's storage and remove the largest things you don't need",
      why: "Storage settings show what takes space. Old videos, podcasts and offline media are common culprits."
    },
    {
      id: "d73-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: tidy your desktop again",
      why: "A desktop stays clean only with a weekly habit. One minute is enough."
    },
    {
      id: "d74-dig", level: "dig", difficulty: 1,
      title: "Remove browser extensions you don't use",
      why: "Extensions can read your browsing and slow your browser. Keep only the ones you trust and use."
    },
    {
      id: "d75-dig", level: "dig", difficulty: 2,
      title: "Clean up your bookmarks: delete dead links and ones you never visit",
      why: "Bookmarks pile up as 'for later' that never comes. Keep a short list you actually use."
    },
    {
      id: "d76-dig", level: "dig", difficulty: 1,
      title: "Close all your browser tabs; save only the few you need",
      why: "Open tabs are unfinished thoughts. Closing them clears both memory and mind."
    },
    {
      id: "d77-dig", level: "dig", difficulty: 1,
      title: "Disable unnecessary programs that start with your computer",
      why: "Fewer startup programs means a faster, quieter computer."
    },
    {
      id: "d78-dig", level: "dig", difficulty: 2,
      title: "Archive finished projects into one 'Archive' folder",
      why: "Finished work doesn't need to sit next to active work. An archive keeps it safe and out of the way."
    },
    {
      id: "d79-dig", level: "dig", difficulty: 2,
      title: "Gather old USB sticks and memory cards; copy what matters and erase them",
      why: "Small drives hide forgotten files and get lost easily. Consolidate, then reuse or recycle them."
    },
    {
      id: "d80-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: tidy your Downloads folder again",
      why: "Downloads fill up fast. A weekly two-minute sweep keeps it manageable."
    },
    {
      id: "d81-dig", level: "dig", difficulty: 1,
      title: "Clean up your voice memos",
      why: "Voice memos are quick to record and easy to forget. Transcribe what matters and delete the rest."
    },
    {
      id: "d82-dig", level: "dig", difficulty: 2,
      title: "Go through your notes app and delete outdated notes",
      why: "Old lists and half-ideas bury the notes that matter. Keep only what's still useful."
    },
    {
      id: "d83-dig", level: "dig", difficulty: 1,
      title: "Write down a simple file naming rule and use it from now on",
      why: "Consistency makes files easy to find without remembering where you put them."
    },
    {
      id: "d84-dig", level: "dig", difficulty: 1,
      title: "Set default save locations so new files go to the right place",
      why: "When files land in the right folder automatically, clutter never starts."
    },
    {
      id: "d85-dig", level: "dig", difficulty: 1,
      title: "Delete old installer files you've already used",
      why: "Installers are needed once. After installation, they're just taking space."
    },
    {
      id: "d86-dig", level: "dig", difficulty: 1,
      title: "Update your operating system and apps",
      why: "Updates fix security holes. Keeping devices updated is one of the simplest ways to stay safe."
    },
    {
      id: "d87-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: close all tabs at the end of the week",
      why: "A clean browser on Monday is a clean start to the week."
    },
    {
      id: "d88-dig", level: "dig", difficulty: 3,
      title: "Check that you have a working backup of your important files",
      why: "A common rule of thumb is 3-2-1: three copies, on two types of storage, one of them off-site or in the cloud."
    },
    {
      id: "d89-dig", level: "dig", difficulty: 2,
      title: "Test your backup by restoring one file",
      why: "A backup you've never tested is a hope, not a plan. Restoring one file proves it works."
    },
    {
      id: "d90-dig", level: "dig", difficulty: 1,
      title: "March review: how much storage did you free up this month?",
      why: "Freed space is proof of progress, and your devices likely run faster too."
    },
    /* ===== DIGITAL — DAYS 91–120 · APRIL · Photos & media ===== */
    {
      id: "d91-dig", level: "dig", difficulty: 1,
      title: "Check how many photos are in your photo library",
      why: "Most people have thousands. Knowing the number is the first step toward a library you actually enjoy."
    },
    {
      id: "d92-dig", level: "dig", difficulty: 1,
      title: "Delete 100 obvious photos: blurry, duplicates and accidental shots",
      why: "Starting with the obvious removes perfectionism. What's left becomes easier to see and enjoy."
    },
    {
      id: "d93-dig", level: "dig", difficulty: 1,
      title: "Delete screenshots from your photo library",
      why: "Screenshots are usually temporary: a code, an address, a joke. Their job is done."
    },
    {
      id: "d94-dig", level: "dig", difficulty: 1,
      title: "Use your photo app's duplicate finder, if it has one",
      why: "Many photo apps can detect duplicates automatically. Let the tool do the tedious part."
    },
    {
      id: "d95-dig", level: "dig", difficulty: 1,
      title: "From each burst of similar photos, keep only the best one",
      why: "Ten nearly identical shots of the same moment don't make the memory stronger. One great photo does."
    },
    {
      id: "d96-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how does scrolling through your photos feel now?",
      why: "A lighter library is more enjoyable to browse. That's the whole point."
    },
    {
      id: "d97-dig", level: "dig", difficulty: 2,
      title: "Sort videos by size and delete long ones you'll never watch again",
      why: "Videos take up far more space than photos. A few deletions can free gigabytes."
    },
    {
      id: "d98-dig", level: "dig", difficulty: 1,
      title: "Turn off automatic saving of received media in messaging apps",
      why: "Every meme and forwarded video otherwise ends up in your gallery. Save only what you choose."
    },
    {
      id: "d99-dig", level: "dig", difficulty: 2,
      title: "Clear large media from your messaging apps' storage",
      why: "Chat apps have storage tools that show which conversations take the most space."
    },
    {
      id: "d100-dig", level: "dig", difficulty: 1,
      title: "Day 100: choose your ten favorite photos of the year so far",
      why: "Picking favorites trains your eye for what really matters. These are the photos worth keeping close."
    },
    {
      id: "d101-dig", level: "dig", difficulty: 2,
      title: "Create albums only for your most important events",
      why: "A few meaningful albums are easier to revisit than thousands of unsorted images."
    },
    {
      id: "d102-dig", level: "dig", difficulty: 1,
      title: "Set a five-minute weekly habit of deleting unwanted photos",
      why: "Photos accumulate daily. A small weekly habit prevents another big cleanup."
    },
    {
      id: "d103-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: five minutes of photo cleanup",
      why: "Keep the habit alive. Recent photos are the easiest to decide on."
    },
    {
      id: "d104-dig", level: "dig", difficulty: 3,
      title: "Make sure your photos are backed up in at least two places",
      why: "Photos are often the most irreplaceable data we own. A phone can be lost in a second."
    },
    {
      id: "d105-dig", level: "dig", difficulty: 1,
      title: "Delete photos of receipts, notes and parking spots you no longer need",
      why: "Photos used as reminders outlive their purpose quickly. Clear them out."
    },
    {
      id: "d106-dig", level: "dig", difficulty: 2,
      title: "Retrieve photos from old phones or cameras before recycling them",
      why: "Old devices often hold forgotten memories. Move them to your main library, then wipe the device."
    },
    {
      id: "d107-dig", level: "dig", difficulty: 1,
      title: "Remove music from your library that you never listen to",
      why: "A focused library makes it easier to find what you love."
    },
    {
      id: "d108-dig", level: "dig", difficulty: 1,
      title: "Unsubscribe from podcasts with a backlog of unplayed episodes",
      why: "An endless queue of episodes becomes a to-do list. Keep only the shows you look forward to."
    },
    {
      id: "d109-dig", level: "dig", difficulty: 1,
      title: "Delete downloaded videos and series you've already watched",
      why: "Offline downloads are easy to forget and take lots of space."
    },
    {
      id: "d110-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: five minutes of photo and media cleanup",
      why: "Small, regular tidying keeps your media library manageable for good."
    },
    {
      id: "d111-dig", level: "dig", difficulty: 1,
      title: "Trim your streaming watchlist to what you genuinely want to see",
      why: "Long watchlists create decision fatigue. A short list makes choosing a pleasure."
    },
    {
      id: "d112-dig", level: "dig", difficulty: 1,
      title: "Remove finished or unwanted e-books and audiobooks from your devices",
      why: "A digital library can be as cluttered as a physical one. Keep what you're reading or will read."
    },
    {
      id: "d113-dig", level: "dig", difficulty: 2,
      title: "Print a small album of your favorite photos",
      why: "Printed photos are seen and shared. A small curated album brings your digital memories back into life."
    },
    {
      id: "d114-dig", level: "dig", difficulty: 1,
      title: "Before sharing photos publicly, check whether they reveal your location",
      why: "Photos can contain location data, and backgrounds can reveal where you live. A quick check protects your privacy."
    },
    {
      id: "d115-dig", level: "dig", difficulty: 1,
      title: "Leave shared albums that are no longer active",
      why: "Old shared albums keep sending updates and taking space. Save what you want, then leave."
    },
    {
      id: "d116-dig", level: "dig", difficulty: 2,
      title: "Make a plan to digitize old home videos or tapes",
      why: "Old media formats degrade and players disappear. A plan now protects memories for later."
    },
    {
      id: "d117-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how much storage does your phone have free now?",
      why: "Free space is the visible result of invisible work. Keep it that way with small habits."
    },
    {
      id: "d118-dig", level: "dig", difficulty: 1,
      title: "Take one great photo instead of twenty today",
      why: "Fewer photos means more attention on the moment itself, and less to sort later."
    },
    {
      id: "d119-dig", level: "dig", difficulty: 1,
      title: "Delete saved memes and random downloaded images from your gallery",
      why: "They were funny once. Now they're burying the photos that matter."
    },
    {
      id: "d120-dig", level: "dig", difficulty: 1,
      title: "April review: how many photos did you remove, and how does the library feel?",
      why: "A curated library tells your story more clearly. Celebrate the difference."
    },
    /* ===== DIGITAL — DAYS 121–151 · MAY · Social media & news ===== */
    {
      id: "d121-dig", level: "dig", difficulty: 1,
      title: "List every social platform you have an account on",
      why: "Many people have more accounts than they remember. The list is your map for this month."
    },
    {
      id: "d122-dig", level: "dig", difficulty: 1,
      title: "For each platform, write one sentence about the value it brings you",
      why: "If you can't name a clear benefit, the platform may be taking more than it gives."
    },
    {
      id: "d123-dig", level: "dig", difficulty: 2,
      title: "Unfollow 20 accounts that don't inform, inspire or genuinely connect you",
      why: "Your feed is a diet for your mind. Choose what goes into it."
    },
    {
      id: "d124-dig", level: "dig", difficulty: 1,
      title: "Mute keywords or topics that repeatedly upset you",
      why: "Most platforms let you mute words and topics. You can stay informed without constant exposure."
    },
    {
      id: "d125-dig", level: "dig", difficulty: 2,
      title: "Switch to a chronological or 'following only' feed where possible",
      why: "Algorithmic feeds are tuned for engagement, not well-being. A chronological feed has a natural end."
    },
    {
      id: "d126-dig", level: "dig", difficulty: 1,
      title: "Turn off all notifications from social media apps",
      why: "Social apps notify you to bring you back. Visit when you decide, not when they call."
    },
    {
      id: "d127-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how does your feed feel after this week's changes?",
      why: "A curated feed should feel calmer and more useful. Keep adjusting until it does."
    },
    {
      id: "d128-dig", level: "dig", difficulty: 1,
      title: "Choose specific times of day for social media",
      why: "Scheduled visits turn endless scrolling into a bounded activity."
    },
    {
      id: "d129-dig", level: "dig", difficulty: 1,
      title: "Before posting, ask yourself why you're sharing it",
      why: "Posting with intention means sharing more of what matters and less for approval."
    },
    {
      id: "d130-dig", level: "dig", difficulty: 2,
      title: "Delete or archive old posts you no longer identify with",
      why: "Your old posts are a public archive of who you used to be. Keep only what you're comfortable with."
    },
    {
      id: "d131-dig", level: "dig", difficulty: 2,
      title: "Review the privacy settings of one social platform",
      why: "Default settings often share more than you'd expect. Choose who sees what."
    },
    {
      id: "d132-dig", level: "dig", difficulty: 1,
      title: "Leave groups and communities you no longer take part in",
      why: "Inactive memberships still bring notifications and noise. Leave with a clear conscience."
    },
    {
      id: "d133-dig", level: "dig", difficulty: 1,
      title: "Hide like counts where the platform allows it",
      why: "Numbers invite comparison. Without them, you can enjoy content for what it is."
    },
    {
      id: "d134-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: what did you do with time you didn't spend scrolling?",
      why: "Reclaimed time is the real reward. Notice where it went."
    },
    {
      id: "d135-dig", level: "dig", difficulty: 2,
      title: "Choose one or two trusted news sources and check them once or twice a day",
      why: "Constant news checking increases anxiety without making you better informed. Quality beats quantity."
    },
    {
      id: "d136-dig", level: "dig", difficulty: 1,
      title: "Turn off breaking-news alerts",
      why: "Very little news requires your reaction within minutes. You'll still hear about what matters."
    },
    {
      id: "d137-dig", level: "dig", difficulty: 1,
      title: "Replace news scrolling with one daily or weekly summary",
      why: "A good summary gives context that endless headlines don't."
    },
    {
      id: "d138-dig", level: "dig", difficulty: 2,
      title: "Spend one full day without social media",
      why: "One day is enough to notice the pull, and the calm on the other side of it."
    },
    {
      id: "d139-dig", level: "dig", difficulty: 3,
      title: "Close one account you no longer use, after downloading your data",
      why: "Dormant accounts still hold your data and can be breached. Most platforms let you export your data before deleting."
    },
    {
      id: "d140-dig", level: "dig", difficulty: 1,
      title: "Pause or clear your watch history on video platforms to reset recommendations",
      why: "Recommendations reflect past habits. A reset gives you a fresh, more intentional start."
    },
    {
      id: "d141-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which platform do you miss least?",
      why: "The one you don't miss is the easiest to let go of completely."
    },
    {
      id: "d142-dig", level: "dig", difficulty: 1,
      title: "Call a friend instead of commenting on their post",
      why: "A conversation builds connection in a way a comment can't."
    },
    {
      id: "d143-dig", level: "dig", difficulty: 1,
      title: "Follow a few accounts that teach you something useful",
      why: "Social media can be a library if you choose it to be. Replace noise with learning."
    },
    {
      id: "d144-dig", level: "dig", difficulty: 1,
      title: "Unfollow accounts that mostly make you want to buy things",
      why: "Influencer content is often advertising in disguise. Fewer triggers, fewer impulse purchases."
    },
    {
      id: "d145-dig", level: "dig", difficulty: 3,
      title: "Take a seven-day break from one social platform",
      why: "A week away shows what the platform really adds to your life, and what you do instead."
    },
    {
      id: "d146-dig", level: "dig", difficulty: 1,
      title: "Turn on tag review so you approve photos before they appear on your profile",
      why: "You decide what appears under your name. Review settings take a minute."
    },
    {
      id: "d147-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how was your week away from the platform?",
      why: "Notice your mood, focus and free time. Decide how you want to return, if at all."
    },
    {
      id: "d148-dig", level: "dig", difficulty: 1,
      title: "Write down one thing you did with your reclaimed time this month",
      why: "Time given back to reading, walking or people is the real measure of success."
    },
    {
      id: "d149-dig", level: "dig", difficulty: 1,
      title: "Log out of social media on your computer",
      why: "Logging in each time adds a pause, and a moment to decide if you really want to visit."
    },
    {
      id: "d150-dig", level: "dig", difficulty: 2,
      title: "Write your own social media rules: when, where and for how long",
      why: "Personal rules, decided calmly, work better than willpower in the moment."
    },
    {
      id: "d151-dig", level: "dig", difficulty: 1,
      title: "May review: which change to your feeds made the biggest difference?",
      why: "Keep the one change that helped most. Small, lasting changes beat dramatic ones."
    },
    /* ===== DIGITAL — DAYS 152–181 · JUNE · Offline & travel ===== */
    {
      id: "d152-dig", level: "dig", difficulty: 1,
      title: "Choose a day for a digital sabbath and put it in your calendar",
      why: "A planned offline day is more likely to happen than a vague intention."
    },
    {
      id: "d153-dig", level: "dig", difficulty: 1,
      title: "Download offline maps for your next trip",
      why: "Offline maps work without data and keep you from constantly checking your phone for signal."
    },
    {
      id: "d154-dig", level: "dig", difficulty: 2,
      title: "Store secure digital copies of your travel documents",
      why: "If a passport is lost, a copy speeds up replacement. Keep it in an encrypted or password-protected place."
    },
    {
      id: "d155-dig", level: "dig", difficulty: 1,
      title: "Set up an out-of-office reply before your holiday",
      why: "Clear expectations let you truly disconnect without guilt."
    },
    {
      id: "d156-dig", level: "dig", difficulty: 2,
      title: "Remove or pause work email on your phone during holidays",
      why: "A holiday with work email in your pocket is only half a holiday."
    },
    {
      id: "d157-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how often did you check your phone without a reason?",
      why: "Noticing reasonless checks is the first step toward fewer of them."
    },
    {
      id: "d158-dig", level: "dig", difficulty: 1,
      title: "Download a few books or podcasts intentionally, not dozens",
      why: "Choosing a few in advance saves you from endless browsing on the road."
    },
    {
      id: "d159-dig", level: "dig", difficulty: 1,
      title: "Bring a paper book to the beach or park",
      why: "A paper book has no notifications. It invites deeper, calmer attention."
    },
    {
      id: "d160-dig", level: "dig", difficulty: 1,
      title: "On your next outing, take a few photos and then put the phone away",
      why: "Being present creates better memories than documenting everything."
    },
    {
      id: "d161-dig", level: "dig", difficulty: 1,
      title: "Turn off mobile data for apps that don't need it",
      why: "Fewer apps using data means fewer background updates, less battery drain and fewer interruptions."
    },
    {
      id: "d162-dig", level: "dig", difficulty: 1,
      title: "Share holiday photos after you're back, not in real time",
      why: "Posting later lets you enjoy the moment, and it's safer not to announce that your home is empty."
    },
    {
      id: "d163-dig", level: "dig", difficulty: 3,
      title: "Digital sabbath: spend 24 hours offline, or as close as you can",
      why: "Allow calls from family and essential tools if needed. Notice how the day stretches."
    },
    {
      id: "d164-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: what did you notice during your digital sabbath?",
      why: "The feelings, restlessness at first then calm, are useful information about your habits."
    },
    {
      id: "d165-dig", level: "dig", difficulty: 1,
      title: "Decide whether you want to make a digital sabbath a regular habit",
      why: "Once a month or once a week, a regular offline day is a powerful reset."
    },
    {
      id: "d166-dig", level: "dig", difficulty: 1,
      title: "Plan a screen-free evening with friends or family",
      why: "Shared offline time is the heart of digital minimalism: people over pixels."
    },
    {
      id: "d167-dig", level: "dig", difficulty: 1,
      title: "Walk without headphones today and listen to your surroundings",
      why: "Constant input leaves no room for your own thoughts. Silence is where ideas appear."
    },
    {
      id: "d168-dig", level: "dig", difficulty: 1,
      title: "Delete travel apps you used only for one trip",
      why: "Booking and transport apps pile up after trips. You can reinstall them next time."
    },
    {
      id: "d169-dig", level: "dig", difficulty: 1,
      title: "Remove expired tickets, boarding passes and cards from your digital wallet",
      why: "A clean wallet app shows only what's valid and useful."
    },
    {
      id: "d170-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which offline habit do you want to keep?",
      why: "Summer is a good time to test new habits. Pick one to carry into autumn."
    },
    {
      id: "d171-dig", level: "dig", difficulty: 1,
      title: "Use airplane mode for one hour of focused work or reading",
      why: "Airplane mode is the simplest focus tool you already own."
    },
    {
      id: "d172-dig", level: "dig", difficulty: 1,
      title: "Watch a sunset without photographing it",
      why: "Some moments are meant to be lived, not captured."
    },
    {
      id: "d173-dig", level: "dig", difficulty: 1,
      title: "Handwrite a postcard or letter instead of sending a message",
      why: "A handwritten note takes more time, and that's exactly why it's treasured."
    },
    {
      id: "d174-dig", level: "dig", difficulty: 1,
      title: "Clean up saved places and old searches in your maps app",
      why: "Saved places accumulate over years. Keep the ones you'll return to."
    },
    {
      id: "d175-dig", level: "dig", difficulty: 2,
      title: "Right after a trip, choose the best photos and delete the rest",
      why: "Decisions are easiest while memories are fresh. Waiting makes it harder."
    },
    {
      id: "d176-dig", level: "dig", difficulty: 1,
      title: "Share trip photos in one shared album instead of dozens of messages",
      why: "One album is easier for everyone to enjoy and keeps chats light."
    },
    {
      id: "d177-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: compare your screen time with January",
      why: "Six months of small changes may have shifted your habits more than you realize."
    },
    {
      id: "d178-dig", level: "dig", difficulty: 1,
      title: "Half-year review: which digital change has helped you most?",
      why: "Knowing what worked lets you build the second half of the year on solid ground."
    },
    {
      id: "d179-dig", level: "dig", difficulty: 2,
      title: "Audit your notifications again: which new apps have slipped in?",
      why: "New apps turn notifications on by default. A regular audit keeps your phone quiet."
    },
    {
      id: "d180-dig", level: "dig", difficulty: 2,
      title: "Try a 'minimal phone' day: calls, messages and maps only",
      why: "Using the phone only as a tool for a day shows how much of the rest is optional."
    },
    {
      id: "d181-dig", level: "dig", difficulty: 1,
      title: "List your most important accounts: email, banking, cloud, phone",
      why: "This month is about security. Knowing which accounts matter most tells you where to start."
    },
    /* ===== DIGITAL — DAYS 182–212 · JULY · Security & privacy ===== */
    {
      id: "d182-dig", level: "dig", difficulty: 3,
      title: "Install a password manager and add your most important accounts",
      why: "A password manager remembers strong, unique passwords for you. It's the single biggest security upgrade most people can make."
    },
    {
      id: "d183-dig", level: "dig", difficulty: 2,
      title: "Replace reused passwords, starting with your main email account",
      why: "Your email can reset every other account, so it deserves the strongest, unique password. Let your password manager generate it."
    },
    {
      id: "d184-dig", level: "dig", difficulty: 2,
      title: "Turn on two-factor authentication for your email",
      why: "A second step, like an app code or security key, stops most account takeovers even if your password leaks."
    },
    {
      id: "d185-dig", level: "dig", difficulty: 2,
      title: "Turn on two-factor authentication for banking and your other key accounts",
      why: "Protect the accounts that matter most first. An authenticator app is generally safer than SMS codes."
    },
    {
      id: "d186-dig", level: "dig", difficulty: 1,
      title: "Use a passkey on one service that offers it",
      why: "Passkeys let you sign in with your fingerprint, face or device PIN, and they can't be phished like passwords."
    },
    {
      id: "d187-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how many accounts are now in your password manager?",
      why: "Every account you move is one less password to remember and one less weak spot."
    },
    {
      id: "d188-dig", level: "dig", difficulty: 1,
      title: "Check whether your email appears in known data breaches, and change affected passwords",
      why: "Services like Have I Been Pwned show whether your address was part of a known breach. Change the password when it has been exposed, not on a fixed schedule."
    },
    {
      id: "d189-dig", level: "dig", difficulty: 2,
      title: "Save your recovery codes somewhere safe and offline",
      why: "If you lose your phone, recovery codes are how you get back into your accounts. Print them or store them in your password manager."
    },
    {
      id: "d190-dig", level: "dig", difficulty: 1,
      title: "Update the recovery phone number and email on your main accounts",
      why: "Outdated recovery details can lock you out forever. It takes a minute to check."
    },
    {
      id: "d191-dig", level: "dig", difficulty: 2,
      title: "Review which apps can access your camera, microphone and contacts",
      why: "Many apps ask for more access than they need. Remove permissions that don't make sense."
    },
    {
      id: "d192-dig", level: "dig", difficulty: 1,
      title: "Set location access to 'only while using' or 'never' for most apps",
      why: "Location data draws a detailed map of your life. Few apps need it in the background."
    },
    {
      id: "d193-dig", level: "dig", difficulty: 2,
      title: "Remove third-party apps connected to your main Google, Apple or social accounts",
      why: "'Sign in with' connections pile up over years and may still have access to your data."
    },
    {
      id: "d194-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which security step felt most reassuring?",
      why: "Security is peace of mind. Notice which step gave you the most of it."
    },
    {
      id: "d195-dig", level: "dig", difficulty: 1,
      title: "Use a strong screen lock and a short auto-lock time",
      why: "Your phone holds your whole life. A strong PIN or biometrics protects it if it's lost."
    },
    {
      id: "d196-dig", level: "dig", difficulty: 1,
      title: "Turn on 'Find my device' and remote erase",
      why: "If your phone or laptop is lost, you can locate it or wipe it so your data stays safe."
    },
    {
      id: "d197-dig", level: "dig", difficulty: 1,
      title: "Turn on automatic security updates on all your devices",
      why: "Most attacks use known holes that updates already fixed. Automatic updates close them without effort."
    },
    {
      id: "d198-dig", level: "dig", difficulty: 3,
      title: "Change your router's default admin password and update its firmware",
      why: "Routers are often left with factory settings for years. They guard every device in your home."
    },
    {
      id: "d199-dig", level: "dig", difficulty: 1,
      title: "Forget old Wi-Fi networks saved on your phone and laptop",
      why: "Saved networks can make devices connect automatically to lookalike hotspots. Keep only the ones you use."
    },
    {
      id: "d200-dig", level: "dig", difficulty: 2,
      title: "Day 200: remove saved passwords from your browser once they're in your manager",
      why: "Keeping passwords in one trusted place is simpler and safer than several copies."
    },
    {
      id: "d201-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which accounts still lack two-factor authentication?",
      why: "A short list of remaining accounts turns security into a finishable task."
    },
    {
      id: "d202-dig", level: "dig", difficulty: 1,
      title: "Limit ad personalization in your phone and account settings",
      why: "Less tracking means fewer targeted ads following you around, and fewer impulses."
    },
    {
      id: "d203-dig", level: "dig", difficulty: 1,
      title: "Clear cookies and site data for websites you no longer visit",
      why: "Old cookies keep tracking information for years. A cleanup gives you a lighter, more private browser."
    },
    {
      id: "d204-dig", level: "dig", difficulty: 1,
      title: "Remove old Bluetooth devices from your paired list",
      why: "Old pairings clutter menus and can cause connection mix-ups. Keep only what you use."
    },
    {
      id: "d205-dig", level: "dig", difficulty: 2,
      title: "Remove smart home devices and apps you no longer use",
      why: "Idle connected devices can still collect data and may stop receiving security updates."
    },
    {
      id: "d206-dig", level: "dig", difficulty: 1,
      title: "Learn the signs of phishing and verify before you click",
      why: "Urgent tone, unexpected links, requests for codes or payments: pause and check through the official app or website."
    },
    {
      id: "d207-dig", level: "dig", difficulty: 2,
      title: "Set a PIN on your SIM card",
      why: "A SIM PIN makes it harder for someone to use your number if your phone is stolen. Keep the PUK code somewhere safe."
    },
    {
      id: "d208-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how does it feel to have fewer passwords to remember?",
      why: "Security done well is simpler, not harder. That's minimalism applied to safety."
    },
    {
      id: "d209-dig", level: "dig", difficulty: 1,
      title: "Share passwords with family through your password manager, not in messages",
      why: "Passwords sent in chats stay there forever. Secure sharing keeps them private."
    },
    {
      id: "d210-dig", level: "dig", difficulty: 2,
      title: "Turn on disk encryption on your computer",
      why: "Built-in encryption protects your files if your laptop is lost or stolen. Save the recovery key safely."
    },
    {
      id: "d211-dig", level: "dig", difficulty: 2,
      title: "Delete old copies of IDs and sensitive documents sent by email or chat",
      why: "Copies of IDs sitting in old messages are a gift to identity thieves. Keep one secure copy only."
    },
    {
      id: "d212-dig", level: "dig", difficulty: 1,
      title: "July review: list the security steps you completed this month",
      why: "A month of security work protects you for years. Write down what's done and what's left."
    },
    /* ===== DIGITAL — DAYS 213–243 · AUGUST · Attention & focus ===== */
    {
      id: "d213-dig", level: "dig", difficulty: 1,
      title: "Read for 30 minutes without any interruptions",
      why: "Deep reading is a skill that screens erode. Thirty quiet minutes start rebuilding it."
    },
    {
      id: "d214-dig", level: "dig", difficulty: 2,
      title: "Do one task at a time for a full hour",
      why: "Switching between tasks costs focus each time. Single-tasking is calmer and often faster."
    },
    {
      id: "d215-dig", level: "dig", difficulty: 1,
      title: "Let yourself be bored for ten minutes without reaching for your phone",
      why: "Boredom is where the mind rests and new ideas form. Waiting in a queue is a good place to practice."
    },
    {
      id: "d216-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: when did you feel most focused this week?",
      why: "Knowing your best focus conditions helps you create them on purpose."
    },
    {
      id: "d217-dig", level: "dig", difficulty: 1,
      title: "Read one long article instead of dozens of headlines",
      why: "Headlines give reactions; long reads give understanding."
    },
    {
      id: "d218-dig", level: "dig", difficulty: 1,
      title: "Choose an analog hobby to spend time on this month",
      why: "Drawing, playing music, gardening, puzzles: hands-on activities restore attention in ways screens can't."
    },
    {
      id: "d219-dig", level: "dig", difficulty: 1,
      title: "Write in a paper journal for ten minutes",
      why: "Writing by hand slows thought down enough to hear it clearly."
    },
    {
      id: "d220-dig", level: "dig", difficulty: 1,
      title: "Watch a film start to finish without a second screen",
      why: "Split attention makes both experiences worse. Give the story your full attention."
    },
    {
      id: "d221-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which analog activity did you enjoy most?",
      why: "Offline pleasures are easy to forget. Notice the ones worth making room for."
    },
    {
      id: "d222-dig", level: "dig", difficulty: 3,
      title: "Schedule a 90-minute deep work block with all notifications off",
      why: "Long, uninterrupted blocks are where meaningful work happens. Protect one as you would an important meeting."
    },
    {
      id: "d223-dig", level: "dig", difficulty: 1,
      title: "Replace one digital habit with a physical one, like a paper notebook",
      why: "Physical tools have natural limits and no notifications. They keep you in the task."
    },
    {
      id: "d224-dig", level: "dig", difficulty: 1,
      title: "Listen to a full album from start to finish, doing nothing else",
      why: "Music becomes background when we multitask. Listening fully turns it back into an experience."
    },
    {
      id: "d225-dig", level: "dig", difficulty: 1,
      title: "Spend time in nature without any devices",
      why: "Nature restores attention naturally. Leave the phone in your bag or at home."
    },
    {
      id: "d226-dig", level: "dig", difficulty: 1,
      title: "Try five minutes of quiet breathing without an app",
      why: "You don't need a subscription to sit still. Just breathe and notice."
    },
    {
      id: "d227-dig", level: "dig", difficulty: 1,
      title: "Have one conversation today with no phone in sight",
      why: "Even a visible phone reduces the depth of a conversation. Put it away and listen."
    },
    {
      id: "d228-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how long can you read now before reaching for your phone?",
      why: "Attention grows with practice. Notice any improvement, however small."
    },
    {
      id: "d229-dig", level: "dig", difficulty: 1,
      title: "Notice how often you feel phantom vibrations or check for no reason",
      why: "These reflexes show how deeply the phone has trained us. Noticing them weakens them."
    },
    {
      id: "d230-dig", level: "dig", difficulty: 1,
      title: "Visit a library or bookshop and browse slowly",
      why: "Physical browsing leads to unexpected discoveries that algorithms don't offer."
    },
    {
      id: "d231-dig", level: "dig", difficulty: 1,
      title: "Use a paper to-do list for a whole day",
      why: "A paper list can't distract you. Crossing items off is satisfying too."
    },
    {
      id: "d232-dig", level: "dig", difficulty: 1,
      title: "Play a board or card game with others",
      why: "Games around a table bring people together in a way shared screens rarely do."
    },
    {
      id: "d233-dig", level: "dig", difficulty: 2,
      title: "Spend a weekend morning completely screen-free",
      why: "A slow, screen-free morning sets a calmer tone for the whole weekend."
    },
    {
      id: "d234-dig", level: "dig", difficulty: 1,
      title: "Spend an hour learning a practical skill offline",
      why: "Cooking, repairing, sewing or sketching: learning with your hands builds lasting satisfaction."
    },
    {
      id: "d235-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: what did you learn or create this week?",
      why: "Creating something feels different from consuming. Notice the balance between the two."
    },
    {
      id: "d236-dig", level: "dig", difficulty: 1,
      title: "At your next concert or event, film one short clip at most",
      why: "Watching through a screen puts distance between you and the moment."
    },
    {
      id: "d237-dig", level: "dig", difficulty: 1,
      title: "Try a 'one episode' rule for series this week",
      why: "Choosing when to stop, rather than letting the next episode decide, keeps evenings yours."
    },
    {
      id: "d238-dig", level: "dig", difficulty: 1,
      title: "Sit outside in the evening and simply look at the sky",
      why: "Summer nights invite slowness. Ten minutes of looking up is a simple reset."
    },
    {
      id: "d239-dig", level: "dig", difficulty: 1,
      title: "Visit a friend in person instead of chatting online",
      why: "Time together in person creates connection that messages can't replace."
    },
    {
      id: "d240-dig", level: "dig", difficulty: 1,
      title: "Name the offline activity that refreshed you most this summer",
      why: "This is the activity to protect in busier seasons."
    },
    {
      id: "d241-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: are your screen habits holding after the summer?",
      why: "The transition back to routine is when old habits return. Stay aware."
    },
    {
      id: "d242-dig", level: "dig", difficulty: 1,
      title: "Plan a few offline activities for the autumn",
      why: "Planned activities are more likely to happen and easier to choose over screens."
    },
    {
      id: "d243-dig", level: "dig", difficulty: 1,
      title: "August review: what did a month of focus and offline time teach you?",
      why: "Attention is a resource. Notice what you want to keep spending it on."
    },
    /* ===== DIGITAL — DAYS 244–273 · SEPTEMBER · Productivity ===== */
    {
      id: "d244-dig", level: "dig", difficulty: 3,
      title: "Choose one task manager and move all your tasks into it",
      why: "Tasks spread across notes, emails and sticky notes are easy to forget. One trusted list frees your mind."
    },
    {
      id: "d245-dig", level: "dig", difficulty: 2,
      title: "Write down every open loop on your mind",
      why: "Unfinished tasks keep circling in your head. Writing them all down lets your mind rest."
    },
    {
      id: "d246-dig", level: "dig", difficulty: 1,
      title: "Delete old recurring events and outdated entries from your calendar",
      why: "A calendar full of stale events hides the ones that matter."
    },
    {
      id: "d247-dig", level: "dig", difficulty: 2,
      title: "Set up a 30-minute weekly review of tasks and calendar",
      why: "A weekly look back and ahead keeps everything under control without daily stress."
    },
    {
      id: "d248-dig", level: "dig", difficulty: 1,
      title: "Plan tomorrow in time blocks before you finish today",
      why: "Knowing what comes first tomorrow makes starting easier and ending today calmer."
    },
    {
      id: "d249-dig", level: "dig", difficulty: 1,
      title: "Set your working hours or status in work chat apps",
      why: "Clear availability helps colleagues know when to expect replies, and protects your evenings."
    },
    {
      id: "d250-dig", level: "dig", difficulty: 1,
      title: "Silence work notifications outside working hours",
      why: "Rest needs boundaries. Work will still be there tomorrow morning."
    },
    {
      id: "d251-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: did your task list help or overwhelm you this week?",
      why: "A good system reduces stress. If yours doesn't, simplify it."
    },
    {
      id: "d252-dig", level: "dig", difficulty: 2,
      title: "Block a meeting-free focus period in your calendar each week",
      why: "Unprotected time gets filled by others. A recurring block keeps space for real work."
    },
    {
      id: "d253-dig", level: "dig", difficulty: 2,
      title: "Reduce the number of channels people use to reach you",
      why: "Email, three chat apps and texts means five places to check. Agree on fewer."
    },
    {
      id: "d254-dig", level: "dig", difficulty: 1,
      title: "Archive old folders in shared drives",
      why: "Shared drives fill with finished projects. Archiving them helps everyone find current work."
    },
    {
      id: "d255-dig", level: "dig", difficulty: 1,
      title: "Learn three keyboard shortcuts you'll use daily",
      why: "Small frictions add up. Shortcuts save seconds that become hours over a year."
    },
    {
      id: "d256-dig", level: "dig", difficulty: 1,
      title: "Work with one browser window and a handful of tabs",
      why: "Fewer tabs mean fewer temptations and a faster computer."
    },
    {
      id: "d257-dig", level: "dig", difficulty: 1,
      title: "Go through your read-later list: read it now or delete it",
      why: "Saved articles pile up unread. If it's not worth reading now, it may never be."
    },
    {
      id: "d258-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how many tabs are open right now?",
      why: "The number of open tabs is a good measure of mental clutter."
    },
    {
      id: "d259-dig", level: "dig", difficulty: 1,
      title: "Remove unused apps from your computer's dock or taskbar",
      why: "Keep only the tools you open daily within one click."
    },
    {
      id: "d260-dig", level: "dig", difficulty: 1,
      title: "Settle on one default app for each job: notes, calendar, music",
      why: "Two apps for the same job means twice the decisions and scattered information."
    },
    {
      id: "d261-dig", level: "dig", difficulty: 2,
      title: "Automate one repetitive task, like a recurring bill payment",
      why: "Automation removes small decisions and forgotten deadlines. Review it occasionally to stay in control."
    },
    {
      id: "d262-dig", level: "dig", difficulty: 2,
      title: "Add your remaining accounts to your password manager",
      why: "Finishing the move means you never have to remember or reuse a password again."
    },
    {
      id: "d263-dig", level: "dig", difficulty: 1,
      title: "Keep all your notes in one app",
      why: "Notes spread across apps are hard to find. One place makes your notes a real resource."
    },
    {
      id: "d264-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: do your weekly review",
      why: "Consistency makes the review quick. It's the habit that holds the system together."
    },
    {
      id: "d265-dig", level: "dig", difficulty: 1,
      title: "Create an end-of-day shutdown ritual: close apps, review tomorrow, log off",
      why: "A clear ending lets your mind leave work behind."
    },
    {
      id: "d266-dig", level: "dig", difficulty: 2,
      title: "Bring your inbox to zero once, just to see how it feels",
      why: "Inbox zero isn't a daily rule, but reaching it once shows it's possible and feels light."
    },
    {
      id: "d267-dig", level: "dig", difficulty: 1,
      title: "Say no to one digital commitment: a group, a webinar or a newsletter",
      why: "Every yes to something less important is a no to something that matters more."
    },
    {
      id: "d268-dig", level: "dig", difficulty: 1,
      title: "Unsubscribe from event and webinar reminder emails",
      why: "Invitations you'll never attend fill your inbox. Unsubscribe from the organizers."
    },
    {
      id: "d269-dig", level: "dig", difficulty: 1,
      title: "Remove calendar subscriptions you no longer need",
      why: "Holiday calendars, sports fixtures and old shared calendars add clutter to every view."
    },
    {
      id: "d270-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which productivity change saved you the most time?",
      why: "Keep the tools and habits that pay back more than they cost."
    },
    {
      id: "d271-dig", level: "dig", difficulty: 1,
      title: "Mute or leave work chat channels you don't need to follow",
      why: "Channels multiply quickly. Stay in those where you contribute or need the information."
    },
    {
      id: "d272-dig", level: "dig", difficulty: 1,
      title: "September review: which system are you keeping?",
      why: "A simple system you use beats a perfect one you abandon."
    },
    {
      id: "d273-dig", level: "dig", difficulty: 2,
      title: "List all your subscriptions by checking your bank and card statements",
      why: "Subscriptions hide in small monthly charges. Statements reveal the full picture."
    },
    /* ===== DIGITAL — DAYS 274–304 · OCTOBER · Accounts & subscriptions ===== */
    {
      id: "d274-dig", level: "dig", difficulty: 3,
      title: "Cancel every subscription you haven't used in the last 30 days",
      why: "Small monthly charges add up quietly. You can always resubscribe if you truly miss something."
    },
    {
      id: "d275-dig", level: "dig", difficulty: 1,
      title: "Set a reminder before any free trial ends, or skip the trial",
      why: "Free trials are designed to turn into paid subscriptions you forget about."
    },
    {
      id: "d276-dig", level: "dig", difficulty: 2,
      title: "Rotate streaming services instead of paying for several at once",
      why: "Subscribe to one, watch what you want, cancel and move on. Same content, lower cost."
    },
    {
      id: "d277-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how much will this month's cancellations save you per year?",
      why: "Multiply monthly savings by twelve. The number is usually motivating."
    },
    {
      id: "d278-dig", level: "dig", difficulty: 2,
      title: "Search your email for 'welcome' and 'verify your account' to find forgotten accounts",
      why: "Every sign-up left a trace in your inbox. It's the easiest way to map your digital footprint."
    },
    {
      id: "d279-dig", level: "dig", difficulty: 3,
      title: "Delete three old accounts you no longer use",
      why: "Each forgotten account holds personal data that could leak in a breach. Fewer accounts, smaller risk."
    },
    {
      id: "d280-dig", level: "dig", difficulty: 1,
      title: "Delete old forum, game and app accounts from years ago",
      why: "Old usernames and profiles live on long after you've moved on. Close what you can."
    },
    {
      id: "d281-dig", level: "dig", difficulty: 2,
      title: "Search your name online and ask for outdated information to be removed",
      why: "Old profiles and pages can surface for years. Many sites offer a removal or correction process."
    },
    {
      id: "d282-dig", level: "dig", difficulty: 2,
      title: "Ask one company that sends you marketing to delete your data",
      why: "In the EU, the GDPR gives you the right to request erasure of your personal data in many cases. A short email is often enough."
    },
    {
      id: "d283-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how many accounts have you closed so far?",
      why: "Each closed account is one less thing to secure, update and worry about."
    },
    {
      id: "d284-dig", level: "dig", difficulty: 1,
      title: "Keep only the loyalty apps you actually use",
      why: "Loyalty apps collect data and send offers. Keep the one or two that give real value."
    },
    {
      id: "d285-dig", level: "dig", difficulty: 1,
      title: "Cancel unused cloud storage plans",
      why: "After consolidating your files, extra storage plans are money for nothing."
    },
    {
      id: "d286-dig", level: "dig", difficulty: 1,
      title: "Let go of unused domain names, websites or hosting plans",
      why: "Side projects that never launched often keep charging every year."
    },
    {
      id: "d287-dig", level: "dig", difficulty: 1,
      title: "Share family plans instead of paying for separate accounts",
      why: "Many services offer family sharing. One plan for the household is simpler and cheaper."
    },
    {
      id: "d288-dig", level: "dig", difficulty: 1,
      title: "Check the subscriptions list in your phone's app store",
      why: "App subscriptions are easy to forget because they're billed through the store. Review them there."
    },
    {
      id: "d289-dig", level: "dig", difficulty: 1,
      title: "Remove old devices registered to your accounts",
      why: "Old phones and tablets may still be listed with access. Removing them keeps your accounts tidy and safe."
    },
    {
      id: "d290-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how light does your digital footprint feel now?",
      why: "Fewer accounts and subscriptions means fewer bills, passwords and worries."
    },
    {
      id: "d291-dig", level: "dig", difficulty: 1,
      title: "Update accounts still linked to an old phone number",
      why: "An old number may be reassigned to someone else, who could then receive your codes."
    },
    {
      id: "d292-dig", level: "dig", difficulty: 1,
      title: "Make sure your government and tax portal logins are in your password manager",
      why: "These are the accounts you need at the least convenient moments. Keep them ready."
    },
    {
      id: "d293-dig", level: "dig", difficulty: 2,
      title: "Write a short list of your essential accounts for emergencies",
      why: "In an emergency, someone you trust may need to know which accounts exist. The list doesn't need passwords."
    },
    {
      id: "d294-dig", level: "dig", difficulty: 1,
      title: "Delete accounts in messaging apps you no longer use",
      why: "Dormant messaging accounts still show you as reachable. Close them to simplify communication."
    },
    {
      id: "d295-dig", level: "dig", difficulty: 1,
      title: "Delete old notification emails from services you've closed",
      why: "Once an account is gone, its emails are just clutter."
    },
    {
      id: "d296-dig", level: "dig", difficulty: 1,
      title: "Do a second newsletter sweep: unsubscribe from anything new you ignore",
      why: "New subscriptions creep in over months. A quick sweep keeps your inbox calm."
    },
    {
      id: "d297-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which account or subscription was hardest to cancel?",
      why: "Services that make leaving hard deserve extra scrutiny next time you sign up."
    },
    {
      id: "d298-dig", level: "dig", difficulty: 1,
      title: "Add up your total monthly spending on digital services",
      why: "Seeing the full number helps you decide what's truly worth paying for."
    },
    {
      id: "d299-dig", level: "dig", difficulty: 1,
      title: "Put a yearly subscription review date in your calendar",
      why: "One scheduled review a year stops subscriptions from creeping back."
    },
    {
      id: "d300-dig", level: "dig", difficulty: 1,
      title: "Day 300: compare how many apps you have now with the start of the year",
      why: "Three hundred days of small choices shape a lighter digital life. See the difference."
    },
    {
      id: "d301-dig", level: "dig", difficulty: 1,
      title: "Uninstall game launchers and libraries you no longer use",
      why: "Game platforms often start automatically and update large files in the background."
    },
    {
      id: "d302-dig", level: "dig", difficulty: 1,
      title: "Remove unused apps and accounts from your smart TV",
      why: "TV apps pile up and some track viewing habits. Keep the ones you watch."
    },
    {
      id: "d303-dig", level: "dig", difficulty: 2,
      title: "Check which devices are signed in to your main accounts and sign out unknown ones",
      why: "Most services list active sessions. Unknown devices are worth removing and investigating."
    },
    {
      id: "d304-dig", level: "dig", difficulty: 1,
      title: "October review: how many accounts and subscriptions did you remove?",
      why: "A smaller footprint is easier to protect and cheaper to maintain."
    },
    /* ===== DIGITAL — DAYS 305–334 · NOVEMBER · Shopping & ads ===== */
    {
      id: "d305-dig", level: "dig", difficulty: 2,
      title: "Before sales season, unsubscribe from all store newsletters",
      why: "Sales emails are designed to create urgency. Without them, you shop only when you decide to."
    },
    {
      id: "d306-dig", level: "dig", difficulty: 1,
      title: "Remove saved cards from shopping sites you rarely use",
      why: "Saved cards make impulse buying effortless and raise the risk if a site is breached."
    },
    {
      id: "d307-dig", level: "dig", difficulty: 1,
      title: "Turn off notifications from shopping apps",
      why: "Shopping notifications exist to make you buy. You'll still find the store when you need it."
    },
    {
      id: "d308-dig", level: "dig", difficulty: 1,
      title: "Delete shopping apps you use only occasionally",
      why: "The website works just as well for occasional purchases, with less temptation in your pocket."
    },
    {
      id: "d309-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how many shopping emails still reach you?",
      why: "Each one is a candidate for unsubscribing. Keep going until the inbox is quiet."
    },
    {
      id: "d310-dig", level: "dig", difficulty: 1,
      title: "Empty your online shopping carts",
      why: "Full carts are open decisions that pull you back. Clear them and start fresh."
    },
    {
      id: "d311-dig", level: "dig", difficulty: 1,
      title: "Move your online wishlist items into a 30-day waiting list",
      why: "Waiting separates real needs from passing wants. Most items won't survive the month."
    },
    {
      id: "d312-dig", level: "dig", difficulty: 1,
      title: "Turn off one-click buying wherever it's enabled",
      why: "A little friction at checkout gives you a moment to reconsider."
    },
    {
      id: "d313-dig", level: "dig", difficulty: 2,
      title: "Use your browser's privacy or tracking-protection settings to reduce ads",
      why: "Fewer ads following you means fewer reminders of things you didn't need."
    },
    {
      id: "d314-dig", level: "dig", difficulty: 1,
      title: "Unfollow brands on social media",
      why: "Brand accounts are advertising you've invited into your feed."
    },
    {
      id: "d315-dig", level: "dig", difficulty: 1,
      title: "Set price alerts only for items already on your needs list",
      why: "Price alerts for random items create desire. For planned purchases, they save money."
    },
    {
      id: "d316-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: did you make any impulse purchases online this week?",
      why: "No judgment, just awareness. Notice what triggered them."
    },
    {
      id: "d317-dig", level: "dig", difficulty: 1,
      title: "Consider digital or experience gifts: lessons, tickets, subscriptions they'd love",
      why: "Well-chosen experience gifts bring joy without adding to anyone's clutter."
    },
    {
      id: "d318-dig", level: "dig", difficulty: 3,
      title: "Turn a year of phone photos into one small photo book as a gift",
      why: "A printed book of the best moments is personal, meaningful and uses photos that would otherwise stay hidden."
    },
    {
      id: "d319-dig", level: "dig", difficulty: 1,
      title: "Keep pending returns and refunds in one simple list",
      why: "Returns get forgotten and refunds go unclaimed. One list keeps track."
    },
    {
      id: "d320-dig", level: "dig", difficulty: 1,
      title: "Delete old order and shipping emails, keeping only receipts you need",
      why: "Tracking updates and 'your order has shipped' emails have no value once delivered."
    },
    {
      id: "d321-dig", level: "dig", difficulty: 1,
      title: "Avoid 'buy now, pay later' options for non-essentials",
      why: "Splitting payments makes spending feel smaller than it is. Pay only for what you can afford now."
    },
    {
      id: "d322-dig", level: "dig", difficulty: 1,
      title: "Sales week: open shopping sites only with your list in hand",
      why: "A list decided in advance is the best defense against countdown timers and 'limited offers'."
    },
    {
      id: "d323-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: did you stick to your list during the sales?",
      why: "Whatever the answer, notice what worked and what tempted you."
    },
    {
      id: "d324-dig", level: "dig", difficulty: 1,
      title: "Turn on spending notifications from your bank",
      why: "Real-time notices of what you spend keep you aware without constant checking."
    },
    {
      id: "d325-dig", level: "dig", difficulty: 1,
      title: "Block or opt out of promotional text messages",
      why: "Marketing SMS usually include a way to opt out. Use it every time."
    },
    {
      id: "d326-dig", level: "dig", difficulty: 2,
      title: "Close store accounts you created for a single purchase",
      why: "One-time accounts keep your address and payment history. Close them when you're done."
    },
    {
      id: "d327-dig", level: "dig", difficulty: 1,
      title: "Don't browse deals out of boredom",
      why: "Browsing sales for fun is how unplanned purchases happen. Find another way to rest."
    },
    {
      id: "d328-dig", level: "dig", difficulty: 1,
      title: "Review what you bought in the sales: anything to return?",
      why: "Return windows are still open. It's the best moment to undo regrets."
    },
    {
      id: "d329-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: unsubscribe from the new mailing lists the sales added",
      why: "Every purchase tends to add a newsletter. Clear them before they settle in."
    },
    {
      id: "d330-dig", level: "dig", difficulty: 1,
      title: "Look at e-books, games and digital items bought on sale but never used",
      why: "Digital clutter bought on sale is still clutter. Note it for next time."
    },
    {
      id: "d331-dig", level: "dig", difficulty: 1,
      title: "Delete coupon and deal apps",
      why: "Deal apps keep you shopping for things you didn't plan to buy."
    },
    {
      id: "d332-dig", level: "dig", difficulty: 1,
      title: "Reflect: how much of your shopping this month was prompted by ads?",
      why: "Seeing the influence of advertising helps you choose more freely."
    },
    {
      id: "d333-dig", level: "dig", difficulty: 1,
      title: "November review: which change protected you most from impulse buying?",
      why: "Keep that change active all year, not just in sales season."
    },
    {
      id: "d334-dig", level: "dig", difficulty: 2,
      title: "List your key accounts and how a trusted person could access them in an emergency",
      why: "A digital legacy plan spares your loved ones a painful search. Store it securely."
    },
    /* ===== DIGITAL — DAYS 335–365 · DECEMBER · Legacy, backups & year review ===== */
    {
      id: "d335-dig", level: "dig", difficulty: 2,
      title: "Set up a legacy or inactive-account contact where your services offer it",
      why: "Several major services let you choose who can access or manage your account after a long inactivity or death."
    },
    {
      id: "d336-dig", level: "dig", difficulty: 1,
      title: "Tell one trusted person where your emergency instructions are kept",
      why: "A plan nobody knows about can't help. One conversation is enough."
    },
    {
      id: "d337-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how does it feel to have a plan in place?",
      why: "Preparing for the worst is an act of care that brings peace of mind."
    },
    {
      id: "d338-dig", level: "dig", difficulty: 3,
      title: "Make a complete year-end backup of all your devices",
      why: "The end of the year is an easy date to remember for a full backup. Include phones, computers and photos."
    },
    {
      id: "d339-dig", level: "dig", difficulty: 2,
      title: "Wipe old devices properly, then donate or recycle them",
      why: "A factory reset after signing out of your accounts protects your data. Then give the device a second life."
    },
    {
      id: "d340-dig", level: "dig", difficulty: 1,
      title: "Send a few personal holiday messages instead of one mass message",
      why: "A personal note to a few people means more than a forwarded image to everyone."
    },
    {
      id: "d341-dig", level: "dig", difficulty: 1,
      title: "Plan phone-free time with family or friends over the holidays",
      why: "Holidays are about being together. Agree on moments when phones stay away."
    },
    {
      id: "d342-dig", level: "dig", difficulty: 1,
      title: "Mute busy holiday group chats once the plans are made",
      why: "You can check in when needed without dozens of pings a day."
    },
    {
      id: "d343-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: are screens adding to or taking from your holidays?",
      why: "Notice where devices bring people together and where they pull them apart."
    },
    {
      id: "d344-dig", level: "dig", difficulty: 2,
      title: "Create a 'best of the year' album with your favorite photos",
      why: "A short album of the year's best moments is something you'll actually revisit."
    },
    {
      id: "d345-dig", level: "dig", difficulty: 2,
      title: "Delete this year's photo clutter: duplicates, screenshots and blurry shots",
      why: "Closing the year with a clean library makes next year's memories easier to enjoy."
    },
    {
      id: "d346-dig", level: "dig", difficulty: 2,
      title: "Spend one holiday day completely screen-free",
      why: "A full day of presence is a gift to yourself and the people around you."
    },
    {
      id: "d347-dig", level: "dig", difficulty: 1,
      title: "Set up any new devices with minimal notifications from the start",
      why: "It's easiest to keep a device calm from day one than to fix it later."
    },
    {
      id: "d348-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: which digital habit made this season calmer?",
      why: "Notice what helped, so you can use it again next year."
    },
    {
      id: "d349-dig", level: "dig", difficulty: 1,
      title: "Review your screen time for the whole year",
      why: "Looking at the big picture shows how your habits have really changed."
    },
    {
      id: "d350-dig", level: "dig", difficulty: 1,
      title: "Unsubscribe from newsletters and lists you joined this year but don't read",
      why: "Close the year with an inbox that only holds what you want."
    },
    {
      id: "d351-dig", level: "dig", difficulty: 1,
      title: "Delete apps you installed this year but rarely use",
      why: "New apps slip in all year. A year-end sweep keeps your phone lean."
    },
    {
      id: "d352-dig", level: "dig", difficulty: 1,
      title: "Clear your browser's history, cookies and saved form data for a fresh start",
      why: "A year of stored browsing data is mostly tracking and clutter. Your important logins are safe in your password manager."
    },
    {
      id: "d353-dig", level: "dig", difficulty: 2,
      title: "Move this year's finished files into a folder named for the year",
      why: "A yearly archive keeps current folders clean and old work easy to find."
    },
    {
      id: "d354-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: what are you most proud of in your digital life this year?",
      why: "Recognizing progress motivates you to keep going."
    },
    {
      id: "d355-dig", level: "dig", difficulty: 1,
      title: "Archive this year's emails and start the new year with a clean inbox",
      why: "Everything remains searchable. The new year starts without old weight."
    },
    {
      id: "d356-dig", level: "dig", difficulty: 2,
      title: "Run your password manager's health check: fix weak or reused passwords",
      why: "Most managers flag weak, reused or breached passwords. Fixing a few closes the year securely."
    },
    {
      id: "d357-dig", level: "dig", difficulty: 1,
      title: "Write your personal digital rules for next year",
      why: "A few clear rules, like no phone in the bedroom, carry this year's gains into the next."
    },
    {
      id: "d358-dig", level: "dig", difficulty: 1,
      title: "Choose one digital focus for next year",
      why: "One clear intention is more powerful than a long list of resolutions."
    },
    {
      id: "d359-dig", level: "dig", difficulty: 1,
      title: "Send a thank-you message to someone who helped you this year",
      why: "Technology at its best connects people. Use it for gratitude."
    },
    {
      id: "d360-dig", level: "dig", difficulty: 1,
      title: "Weekly check-in: how does your phone feel compared with a year ago?",
      why: "Calmer, lighter, more useful: notice every difference."
    },
    {
      id: "d361-dig", level: "dig", difficulty: 1,
      title: "Tidy your phone's home screen for the new year",
      why: "Start the year with only the tools that serve you in sight."
    },
    {
      id: "d362-dig", level: "dig", difficulty: 1,
      title: "Clear your computer desktop for the new year",
      why: "A clean desktop on the first working day sets the tone for the year."
    },
    {
      id: "d363-dig", level: "dig", difficulty: 1,
      title: "On New Year's Eve, put the phone away at midnight and be with the people around you",
      why: "The moment is better lived than recorded. Send your wishes the next morning."
    },
    {
      id: "d364-dig", level: "dig", difficulty: 1,
      title: "Come full circle: turn off notifications for one more app, just like Day 1",
      why: "The same small act, a year later, shows how natural these choices have become."
    },
    {
      id: "d365-dig", level: "dig", difficulty: 1,
      title: "Reflect: how does your digital life feel after a year of small changes?",
      why: "Digital minimalism is not about using less technology for its own sake, but using it on purpose. Celebrate how far you've come."
    }
  ],

  el: [
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 1–31 · ΙΑΝΟΥΑΡΙΟΣ · Νέο ξεκίνημα ===== */
    {
      id: "d1-phys", level: "phys", difficulty: 1,
      title: "Άδειασε εντελώς ένα συρτάρι",
      why: "Ένας χώρος που άδειασε ολόκληρος αποδεικνύει ότι η τακτοποίηση θέλει λεπτά, όχι Σαββατοκύριακα. Οι μικρές ολοκληρωμένες νίκες χτίζουν ορμή για ό,τι ακολουθεί."
    },
    {
      id: "d2-phys", level: "phys", difficulty: 1,
      title: "Φτιάξε ένα σταθερό σημείο δίπλα στην πόρτα για κλειδιά, πορτοφόλι και αλληλογραφία",
      why: "Ένα σταθερό «σπίτι» για τα καθημερινά σταματά την ακαταστασία να απλώνεται στο σπίτι και τελειώνει το πρωινό κυνήγι των κλειδιών."
    },
    {
      id: "d3-phys", level: "phys", difficulty: 2,
      title: "Απομάκρυνε από τον πάγκο της κουζίνας ό,τι δεν χρησιμοποιείς καθημερινά",
      why: "Ο πάγκος είναι επιφάνεια εργασίας, όχι αποθήκη. Ο ελεύθερος χώρος κάνει το μαγείρεμα πιο εύκολο και το καθάρισμα πιο γρήγορο."
    },
    {
      id: "d4-phys", level: "phys", difficulty: 1,
      title: "Άδειασε το πορτοφόλι σου: παλιές αποδείξεις, ληγμένες κάρτες, κάρτες πόντων που δεν χρησιμοποιείς",
      why: "Ένα λεπτό πορτοφόλι είναι πιο βολικό και πιο εύκολο να το ελέγχεις. Κράτα μόνο αποδείξεις που ίσως χρειαστείς για επιστροφή ή εγγύηση."
    },
    {
      id: "d5-phys", level: "phys", difficulty: 1,
      title: "Μάζεψε τα ληγμένα φάρμακα και ρώτα το φαρμακείο της γειτονιάς σου αν τα παραλαμβάνει",
      why: "Τα παλιά φάρμακα δεν πάνε ποτέ στην τουαλέτα ή στα κοινά σκουπίδια, γιατί καταλήγουν στο νερό και στο έδαφος. Κράτα τα σε μια σακούλα μέχρι να βρεις σωστό σημείο συλλογής."
    },
    {
      id: "d6-phys", level: "phys", difficulty: 1,
      title: "Κάνε μια βόλτα στο σπίτι και εντόπισε το ένα σημείο που σε αγχώνει περισσότερο",
      why: "Η ενέργεια είναι περιορισμένη. Όταν ξέρεις το μεγαλύτερο σημείο τριβής, η χρονιά αποκτά σαφή πρώτο στόχο αντί για σκόρπιες προσπάθειες."
    },
    {
      id: "d7-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: αφιέρωσε 10 λεπτά για να επιστρέψεις τα πράγματα στη θέση τους",
      why: "Η περισσότερη ακαταστασία δεν είναι περίσσεια, είναι πράγματα εκτός θέσης. Ένα σύντομο εβδομαδιαίο reset εμποδίζει τα μικρά μπάχαλα να γίνουν μεγάλα έργα."
    },
    {
      id: "d8-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε την επιφάνεια πάνω από το ψυγείο και τις άλλες συσκευές",
      why: "Οι επιφάνειες πάνω από τις συσκευές μαζεύουν αθόρυβα σκόνη και ξεχασμένα πράγματα. Όταν τις αδειάζεις, φεύγει οπτικός θόρυβος από το δωμάτιο που χρησιμοποιείς περισσότερο."
    },
    {
      id: "d9-phys", level: "phys", difficulty: 2,
      title: "Αποχωρίσου τα χαλασμένα πράγματα που ειλικρινά δεν θα επισκευάσεις",
      why: "Ένα χαλασμένο αντικείμενο που κρατάς «για να το φτιάξεις κάποτε» είναι μια μικρή καθημερινή υπενθύμιση μιας ανολοκλήρωτης δουλειάς. Επισκεύασέ το αυτή την εβδομάδα ή άφησέ το να φύγει."
    },
    {
      id: "d10-phys", level: "phys", difficulty: 2,
      title: "Χώρισε τη στοίβα της αλληλογραφίας σε τρεις ομάδες: για ενέργεια, για αρχείο, για ανακύκλωση",
      why: "Οι στοίβες χαρτιών μεγαλώνουν επειδή κάθε φύλλο κρύβει μια αναβληθείσα απόφαση. Όταν αποφασίζεις μία φορά, σε μία συνεδρία, καθαρίζει και το τραπέζι και το μυαλό σου."
    },
    {
      id: "d11-phys", level: "phys", difficulty: 1,
      title: "Άδειασε εντελώς το τραπεζάκι του σαλονιού ή το τραπέζι της τραπεζαρίας",
      why: "Οι κοινόχρηστες επιφάνειες γίνονται αποθήκες. Ένα άδειο τραπέζι προσκαλεί γεύματα, κουβέντα και ξεκούραση αντί για στοίβες."
    },
    {
      id: "d12-phys", level: "phys", difficulty: 2,
      title: "Μείωσε τις κούπες και τα ποτήρια στον αριθμό που πραγματικά χρησιμοποιείς",
      why: "Τα περισσότερα ντουλάπια έχουν πολύ περισσότερα ποτήρια από όσα χρησιμοποιεί ένα σπίτι ανάμεσα σε δύο πλυσίματα. Κράτα τα αγαπημένα, χάρισε τα υπόλοιπα."
    },
    {
      id: "d13-phys", level: "phys", difficulty: 1,
      title: "Άδειασε τις τσέπες από τα μπουφάν και τις τσάντες σου",
      why: "Οι τσέπες κρύβουν εισιτήρια, χαρτομάντιλα και αποδείξεις. Το άδειασμα θέλει πέντε λεπτά και συχνά βρίσκεις κάτι χρήσιμο."
    },
    {
      id: "d14-phys", level: "phys", difficulty: 1,
      title: "Γράψε μία πρόταση: πώς θα έμοιαζε το «αρκετό» στο σπίτι σου;",
      why: "Ο μινιμαλισμός δεν σημαίνει να έχεις όσο λιγότερα γίνεται, αλλά να έχεις ό,τι σε εξυπηρετεί. Ένας σαφής ορισμός κάνει κάθε μελλοντική απόφαση πιο εύκολη."
    },
    {
      id: "d15-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε το ντουλάπι του μπάνιου: ληγμένα καλλυντικά, αντηλιακά και δείγματα",
      why: "Τα καλλυντικά έχουν διάρκεια ζωής μετά το άνοιγμα, που συχνά σημειώνεται με ένα μικρό σύμβολο ανοιχτού βάζου. Τα ληγμένα προϊόντα μπορεί να ερεθίσουν το δέρμα και απλώς πιάνουν χώρο."
    },
    {
      id: "d16-phys", level: "phys", difficulty: 3,
      title: "Γέμισε μια σακούλα για δωρεά από όλο το σπίτι και παράδωσέ τη σήμερα",
      why: "Μια σακούλα δωρεάς που μένει εβδομάδες στον διάδρομο είναι απλώς ακαταστασία που άλλαξε θέση. Όταν τη βγάζεις την ίδια μέρα, κλείνει ο κύκλος."
    },
    {
      id: "d17-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε το ψυγείο: ληγμένες σάλτσες, παλιά φαγητά, ξεχασμένα βάζα",
      why: "Ένα τακτοποιημένο ψυγείο σου δείχνει τι έχεις, οπότε πετάς λιγότερο φαγητό και αγοράζεις λιγότερα διπλά."
    },
    {
      id: "d18-phys", level: "phys", difficulty: 2,
      title: "Αντιμετώπισε το «συρτάρι με τα διάφορα»: κράτα μόνο ό,τι έχει σαφή χρήση",
      why: "Κάθε σπίτι έχει ένα συρτάρι όπου καταλήγουν τα πράγματα χωρίς απόφαση. Όταν δίνεις σε καθένα σκοπό ή αποχαιρετισμό, γίνεται ένα χρήσιμο συρτάρι εργαλείων."
    },
    {
      id: "d19-phys", level: "phys", difficulty: 2,
      title: "Συγκέντρωσε τα διπλά: ψαλίδια, μέτρα, κατσαβίδια, συρραπτικά",
      why: "Τα διπλά μοιάζουν με προνοητικότητα, αλλά συνήθως σημαίνουν ότι δεν βρήκες το πρώτο. Ένα καλό αντικείμενο σε γνωστή θέση είναι καλύτερο από τρία σκόρπια."
    },
    {
      id: "d20-phys", level: "phys", difficulty: 1,
      title: "Άδειασε το κομοδίνο σου: κράτα μόνο ό,τι χρησιμοποιείς το βράδυ",
      why: "Η τελευταία επιφάνεια που βλέπεις πριν κοιμηθείς επηρεάζει το πώς χαλαρώνεις. Ένα ήρεμο κομοδίνο στηρίζει ήρεμα βράδια."
    },
    {
      id: "d21-phys", level: "phys", difficulty: 1,
      title: "Φωτογράφισε έναν χώρο που άδειασες αυτόν τον μήνα",
      why: "Οι υπενθυμίσεις «πριν και μετά» κρατούν ζωντανό το κίνητρο τις μέρες που η πρόοδος μοιάζει αόρατη."
    },
    {
      id: "d22-phys", level: "phys", difficulty: 1,
      title: "Κράτα έναν λογικό αριθμό από υφασμάτινες τσάντες για ψώνια· χάρισε τις υπόλοιπες",
      why: "Οι επαναχρησιμοποιούμενες τσάντες βοηθούν το περιβάλλον μόνο όταν ξαναχρησιμοποιούνται. Μια στοίβα από πενήντα ακυρώνει τον σκοπό τους."
    },
    {
      id: "d23-phys", level: "phys", difficulty: 2,
      title: "Ταίριαξε τα τάπερ με τα καπάκια τους· ανακύκλωσε όσα περισσεύουν",
      why: "Τα αταίριαστα τάπερ κάνουν κάθε αποθήκευση φαγητού έναν μικρό γρίφο. Ένα πλήρες σετ που στοιβάζεται εύκολα γλιτώνει χρόνο και χώρο."
    },
    {
      id: "d24-phys", level: "phys", difficulty: 1,
      title: "Υιοθέτησε τον κανόνα «ένα μπαίνει, ένα βγαίνει» για τον επόμενο μήνα",
      why: "Όταν κάθε νέο αντικείμενο αντικαθιστά ένα παλιό, το σπίτι σου σταματά να γεμίζει χωρίς να το καταλαβαίνεις."
    },
    {
      id: "d25-phys", level: "phys", difficulty: 1,
      title: "Κράτα στην είσοδο μόνο τα παπούτσια που φοράς αυτή την εβδομάδα",
      why: "Οι στοίβες παπουτσιών στην πόρτα κάνουν κάθε είσοδο να φαίνεται στριμωγμένη. Φύλαξε τα υπόλοιπα στη θέση τους."
    },
    {
      id: "d26-phys", level: "phys", difficulty: 1,
      title: "Ανακύκλωσε τα εγχειρίδια για πράγματα που δεν έχεις πια· τα περισσότερα υπάρχουν και online",
      why: "Τα εγχειρίδια μαζεύονται αθόρυβα. Κράτα μόνο εγγυήσεις και εγχειρίδια που δεν βρίσκεις στο διαδίκτυο."
    },
    {
      id: "d27-phys", level: "phys", difficulty: 2,
      title: "Καθάρισε το αυτοκίνητο, το καλάθι του ποδηλάτου ή την καθημερινή σου τσάντα",
      why: "Ο χώρος με τον οποίο μετακινείσαι είναι κι αυτός μέρος του σπιτιού σου. Όταν φτάνεις κάπου από καθαρό αυτοκίνητο ή τσάντα, η μέρα ξεκινά αλλιώς."
    },
    {
      id: "d28-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: επέστρεψε κάθε αντικείμενο ενός δωματίου στη θέση του",
      why: "Όταν επαναλαμβάνεις την ίδια μικρή ρουτίνα κάθε εβδομάδα, η τακτοποίηση παύει να είναι έργο και γίνεται συνήθεια."
    },
    {
      id: "d29-phys", level: "phys", difficulty: 1,
      title: "Ανακύκλωσε παλιά περιοδικά, φυλλάδια και καταλόγους",
      why: "Το έντυπο υλικό παλιώνει γρήγορα. Ό,τι θέλεις πραγματικά να ξαναδιαβάσεις συνήθως το ξαναβρίσκεις online."
    },
    {
      id: "d30-phys", level: "phys", difficulty: 1,
      title: "Δοκίμασε κάθε στυλό και μαρκαδόρο· κράτα μόνο όσα γράφουν",
      why: "Όταν πιάνεις ένα στυλό που δεν γράφει, είναι μια μικρή καθημερινή ενόχληση. Ένα ποτήρι με αξιόπιστα στυλό αρκεί στα περισσότερα σπίτια."
    },
    {
      id: "d31-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Ιανουαρίου: γράψε τρία πράγματα που έφυγαν από το σπίτι και πώς νιώθεις",
      why: "Όταν προσέχεις τα αποτελέσματα, η συνήθεια δυναμώνει. Η αίσθηση ελαφρότητας είναι η πραγματική ανταμοιβή, και όταν της δίνεις όνομα, διαρκεί."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 32–59 · ΦΕΒΡΟΥΑΡΙΟΣ · Ντουλάπα & υπνοδωμάτιο ===== */
    {
      id: "d32-phys", level: "phys", difficulty: 2,
      title: "Μέτρησε κάθε ρούχο που έχεις και σημείωσε τον αριθμό",
      why: "Η απογραφή της ντουλάπας θέλει περίπου μισή ώρα, και το σύνολο είναι συχνά πολύ μεγαλύτερο από όσο περιμένουμε. Γίνεται το ειλικρινές σημείο εκκίνησής σου."
    },
    {
      id: "d33-phys", level: "phys", difficulty: 3,
      title: "Βγάλε κάθε ρούχο που δεν φόρεσες έναν χρόνο και αποφάσισε για το καθένα",
      why: "Πέρασε ένας ολόκληρος κύκλος εποχών χωρίς αυτό. Αν δεν υπάρχει σαφής λόγος να το κρατήσεις, κάποιος άλλος θα μπορούσε να το φοράει ήδη."
    },
    {
      id: "d34-phys", level: "phys", difficulty: 1,
      title: "Γύρισε όλες τις κρεμάστρες ανάποδα· γύρνα την καθεμία σωστά όταν φορέσεις το ρούχο",
      why: "Σε λίγους μήνες οι κρεμάστρες θα σου δείξουν, χωρίς εικασίες, τι πραγματικά φοράς."
    },
    {
      id: "d35-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε κάλτσες και εσώρουχα: αποχωρίσου τρύπες, χαλαρά λάστιχα και μοναχικές κάλτσες",
      why: "Αυτά είναι τα ρούχα που αγγίζεις κάθε μέρα. Όταν κρατάς μόνο τα καλά, κάθε πρωί γίνεται λίγο καλύτερο."
    },
    {
      id: "d36-phys", level: "phys", difficulty: 2,
      title: "Δοκίμασε πέντε ρούχα· κράτα μόνο όσα σου κάνουν και σου αρέσουν σήμερα",
      why: "Τα ρούχα που κρατάμε για ένα παλιό ή μελλοντικό σώμα παίρνουν χώρο από τον άνθρωπο που είσαι τώρα."
    },
    {
      id: "d37-phys", level: "phys", difficulty: 1,
      title: "Γράψε τα δέκα ρούχα που φοράς περισσότερο. Τι κοινό έχουν;",
      why: "Τα αγαπημένα σου αποκαλύπτουν το πραγματικό σου στυλ: χρώματα, υφάσματα, γραμμές. Αυτό είναι το σχέδιο για κάθε μελλοντική αγορά."
    },
    {
      id: "d38-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε κάθε ζευγάρι παπούτσια: για επισκευή, για δωρεά ή για αποχωρισμό",
      why: "Τα καλά παπούτσια συχνά αλλάζουν σόλα με πολύ λιγότερα χρήματα από ένα καινούργιο ζευγάρι. Όσα πονάνε δεν θα γίνουν ποτέ άνετα."
    },
    {
      id: "d39-phys", level: "phys", difficulty: 1,
      title: "Κράτα μόνο τις τσάντες και τα σακίδια που πραγματικά χρησιμοποιείς",
      why: "Οι τσάντες κρύβονται η μία μέσα στην άλλη και δεν βλέπουμε πόσες έχουμε. Δύο ή τρεις καλές καλύπτουν σχεδόν κάθε ανάγκη."
    },
    {
      id: "d40-phys", level: "phys", difficulty: 2,
      title: "Τακτοποίησε τα αξεσουάρ: ζώνες, κασκόλ, καπέλα και γυαλιά ηλίου",
      why: "Τα αξεσουάρ είναι μικρά, οπότε πολλαπλασιάζονται απαρατήρητα. Κράτα ό,τι πιάνεις συχνά και ό,τι ολοκληρώνει τα σύνολά σου."
    },
    {
      id: "d41-phys", level: "phys", difficulty: 2,
      title: "Άδειασε τον χώρο κάτω από το κρεβάτι σου",
      why: "Ό,τι είναι κάτω από το κρεβάτι δεν το βλέπεις και το ξεχνάς. Ό,τι μένει εκεί πρέπει να είναι κάτι που επιλέγεις συνειδητά να κρατήσεις."
    },
    {
      id: "d42-phys", level: "phys", difficulty: 2,
      title: "Κράτα δύο σετ σεντόνια για κάθε κρεβάτι· χάρισε τα υπόλοιπα",
      why: "Ένα σετ στο κρεβάτι κι ένα στο πλύσιμο αρκούν. Τα καταφύγια ζώων συχνά δέχονται με χαρά παλιά σεντόνια και πετσέτες."
    },
    {
      id: "d43-phys", level: "phys", difficulty: 1,
      title: "Μείωσε τις πετσέτες σε όσες χρησιμοποιεί πραγματικά το σπίτι",
      why: "Τα ντουλάπια γεμίζουν πετσέτες που δεν πιάνει κανείς. Λιγότερες και καλύτερες αποθηκεύονται και πλένονται πιο εύκολα."
    },
    {
      id: "d44-phys", level: "phys", difficulty: 1,
      title: "Βγάλε από την κρεβατοκάμαρα ένα πράγμα που δεν σχετίζεται με την ξεκούραση",
      why: "Χαρτιά δουλειάς, στοίβες ρούχων και αθλητικά κρατούν το μυαλό σε εγρήγορση την ώρα του ύπνου. Ένα υπνοδωμάτιο μόνο για ξεκούραση κάνει την ξεκούραση πιο εύκολη."
    },
    {
      id: "d45-phys", level: "phys", difficulty: 1,
      title: "Αντιμετώπισε την «καρέκλα» όπου μαζεύονται τα φορεμένα ρούχα",
      why: "Τα μισοφορεμένα ρούχα χρειάζονται μια θέση: μια κρεμάστρα τοίχου, ένα μικρό σταντ ή απλώς την κρεμάστρα ή το καλάθι των απλύτων. Διάλεξε έναν κανόνα και τήρησέ τον."
    },
    {
      id: "d46-phys", level: "phys", difficulty: 1,
      title: "Μάζεψε σε ένα κουτί τα δείγματα και τα μικρά προϊόντα ταξιδιού και χρησιμοποίησέ τα πρώτα",
      why: "Τα μικρά μπουκαλάκια ξεχνιούνται μέχρι να λήξουν. Όταν τα τελειώνεις πριν αγοράσεις καινούργια, κερδίζεις χρήματα και χώρο."
    },
    {
      id: "d47-phys", level: "phys", difficulty: 2,
      title: "Τακτοποίησε το μακιγιάζ και τα εργαλεία περιποίησης· καθάρισε τα πινέλα που κρατάς",
      why: "Το παλιό ή αχρησιμοποίητο μακιγιάζ πιάνει χώρο και μπορεί να έχει μικρόβια. Ό,τι μένει πρέπει να είναι αυτό που όντως χρησιμοποιείς."
    },
    {
      id: "d48-phys", level: "phys", difficulty: 1,
      title: "Αποχωρίσου συσκευές περιποίησης που χρησιμοποίησες μία φορά ή ποτέ",
      why: "Πολλές συσκευές υπόσχονται καλύτερη ρουτίνα και μετά μένουν σε ένα συρτάρι. Η πραγματική σου ρουτίνα είναι αυτό που κάνεις στην πράξη."
    },
    {
      id: "d49-phys", level: "phys", difficulty: 1,
      title: "Απλοποίησε τον χώρο της μπουγάδας: ένα ανοιχτό προϊόν από κάθε είδος",
      why: "Πέντε μισοτελειωμένα απορρυπαντικά γεμίζουν το ράφι. Τελείωσε ό,τι είναι ανοιχτό πριν αγοράσεις άλλο."
    },
    {
      id: "d50-phys", level: "phys", difficulty: 3,
      title: "Ρούχα με συναισθηματική αξία: κράτα το πιο σημαντικό, φωτογράφισε τα υπόλοιπα",
      why: "Οι αναμνήσεις ζουν μέσα σου, όχι στο ύφασμα. Ένα πολύτιμο κομμάτι τιμά την ανάμνηση καλύτερα από ένα κουτί που δεν ανοίγει κανείς."
    },
    {
      id: "d51-phys", level: "phys", difficulty: 1,
      title: "Όρισε τρία αγαπημένα σύνολα στα οποία νιώθεις καλά",
      why: "Όταν ξέρεις τα βασικά σου σύνολα, γλιτώνεις καθημερινές αποφάσεις και βλέπεις ποια κομμάτια είναι πραγματικά απαραίτητα."
    },
    {
      id: "d52-phys", level: "phys", difficulty: 2,
      title: "Αντιμετώπισε τη στοίβα για μπάλωμα: φτιάξε ένα ρούχο σήμερα ή άφησε τα υπόλοιπα να φύγουν",
      why: "Μια στοίβα με ρούχα «για διόρθωση» μπορεί να μείνει χρόνια. Ράψε ένα κουμπί, πήγαινε κάτι στη μοδίστρα ή αποδέξου ότι δεν θα γίνει."
    },
    {
      id: "d53-phys", level: "phys", difficulty: 1,
      title: "Βγάλε τις περιττές κρεμάστρες και αντικατέστησε τις αταίριαστες αν θέλεις",
      why: "Οι επιπλέον κρεμάστρες προσκαλούν επιπλέον ρούχα. Όταν κρατάς μόνο όσες χρειάζεσαι, βάζεις ένα διακριτικό όριο στην ντουλάπα."
    },
    {
      id: "d54-phys", level: "phys", difficulty: 1,
      title: "Κράτα μόνο τα αθλητικά ρούχα με τα οποία πραγματικά γυμνάζεσαι",
      why: "Τα αθλητικά ρούχα πληθαίνουν με κάθε νέα απόφαση. Σημασία έχει αυτό που φοράς όταν κινείσαι."
    },
    {
      id: "d55-phys", level: "phys", difficulty: 2,
      title: "Βάλε σε κουτιά με ετικέτα τα ρούχα άλλης εποχής, ώστε η ντουλάπα να δείχνει μόνο την τρέχουσα",
      why: "Μια ντουλάπα μόνο με τα ρούχα της εποχής είναι πιο εύχρηστη. Όταν αλλάζει η εποχή, έχεις ένα φυσικό σημείο ελέγχου."
    },
    {
      id: "d56-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε τα κοσμήματα: σπασμένα, μονά σκουλαρίκια, μπερδεμένες αλυσίδες",
      why: "Επισκεύασε ό,τι αγαπάς, αποχωρίσου ό,τι δεν φοράς. Λίγα κοσμήματα σε κοινή θέα φοριούνται περισσότερο από έναν κρυμμένο σωρό."
    },
    {
      id: "d57-phys", level: "phys", difficulty: 1,
      title: "Άφησε στις επιφάνειες του μπάνιου μόνο τα καθημερινά",
      why: "Ένας ελεύθερος νιπτήρας καθαρίζεται πιο γρήγορα και δίνει ηρεμία κάθε πρωί και βράδυ."
    },
    {
      id: "d58-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Φεβρουαρίου: μέτρησε ξανά τα ρούχα σου και σύγκρινε με την πρώτη μέτρηση",
      why: "Όταν βλέπεις τη διαφορά σε αριθμούς, η πρόοδος γίνεται απτή, και φαίνεται πόσο λίγο σου έλειψαν όσα έφυγαν."
    },
    {
      id: "d59-phys", level: "phys", difficulty: 2,
      title: "Ξεκίνα ένα «κουτί του ίσως» με ημερομηνία για πράγματα για τα οποία δεν είσαι σίγουρος/η",
      why: "Αν σε 90 ημέρες δεν χρειάστηκες τίποτα από το κουτί, μπορείς να το αφήσεις να φύγει χωρίς τύψεις. Ο χρόνος αποφασίζει για σένα."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 60–90 · ΜΑΡΤΙΟΣ · Ανοιξιάτικη καθαριότητα ===== */
    {
      id: "d60-phys", level: "phys", difficulty: 3,
      title: "Άδειασε το ντουλάπι με τα τρόφιμα, έλεγξε ημερομηνίες και φέρε μπροστά ό,τι λήγει σύντομα",
      why: "Το ανοιξιάτικο καθάρισμα ξεκινά από τα τρόφιμα. Όταν τα βλέπεις όλα μαζί, αποφεύγεις τη σπατάλη και τις διπλές αγορές."
    },
    {
      id: "d61-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τα μπαχαρικά: ένωσε τα διπλά, αποχωρίσου όσα έχασαν το άρωμά τους",
      why: "Τα αλεσμένα μπαχαρικά χάνουν τη γεύση τους με τον καιρό. Αν ένα μπαχαρικό δεν μυρίζει, δεν προσθέτει τίποτα στο φαγητό."
    },
    {
      id: "d62-phys", level: "phys", difficulty: 2,
      title: "Αποχωρίσου μονολειτουργικά σκεύη κουζίνας που δεν χρησιμοποίησες έναν χρόνο",
      why: "Ένα καλό μαχαίρι και λίγα βασικά εργαλεία κάνουν τη δουλειά των περισσότερων gadgets. Τα ελεύθερα συρτάρια κάνουν το μαγείρεμα πιο άνετο."
    },
    {
      id: "d63-phys", level: "phys", difficulty: 2,
      title: "Κράτα τις κατσαρόλες και τα τηγάνια που μαγειρεύεις· χάρισε τα υπόλοιπα",
      why: "Τα περισσότερα γεύματα μαγειρεύονται στα ίδια δύο-τρία σκεύη. Τα υπόλοιπα απλώς δυσκολεύουν κάθε ντουλάπι."
    },
    {
      id: "d64-phys", level: "phys", difficulty: 2,
      title: "Μείωσε τα καθαριστικά σε λίγα βασικά και μην αναμειγνύεις ποτέ χλωρίνη με άλλα καθαριστικά",
      why: "Λίγα προϊόντα πολλαπλών χρήσεων καθαρίζουν τα περισσότερα σπίτια. Η χλωρίνη με αμμωνία ή οξέα βγάζει τοξικά αέρια, οπότε λιγότερα προϊόντα σημαίνει και μεγαλύτερη ασφάλεια."
    },
    {
      id: "d65-phys", level: "phys", difficulty: 1,
      title: "Παρατήρησε ποιο δωμάτιο νιώθεις πιο ελαφρύ τώρα και γιατί",
      why: "Όταν καταλαβαίνεις τι λειτούργησε, μπορείς να το επαναλάβεις στους χώρους που ακόμη βαραίνουν."
    },
    {
      id: "d66-phys", level: "phys", difficulty: 2,
      title: "Άδειασε τα περβάζια και καθάρισε ένα παράθυρο για να μπει περισσότερο φως",
      why: "Το φυσικό φως κάνει κάθε δωμάτιο να φαίνεται μεγαλύτερο. Τα περβάζια είναι συχνά οι πρώτες επιφάνειες που γεμίζουν."
    },
    {
      id: "d67-phys", level: "phys", difficulty: 1,
      title: "Άδειασε το ντουλάπι κάτω από τον νεροχύτη και έλεγξε για διαρροές",
      why: "Αυτό το ντουλάπι κρύβει παλιά προϊόντα και αργές διαρροές. Ένας γρήγορος έλεγχος προλαβαίνει και την ακαταστασία και τις ζημιές από νερό."
    },
    {
      id: "d68-phys", level: "phys", difficulty: 2,
      title: "Κάνε απογραφή στην κατάψυξη και σχεδίασε τρία γεύματα από αυτή",
      why: "Τα κατεψυγμένα ξεχνιούνται εύκολα. Όταν μαγειρεύεις από όσα ήδη έχεις, κερδίζεις χρήματα και χώρο."
    },
    {
      id: "d69-phys", level: "phys", difficulty: 2,
      title: "Κράτα τα βιβλία μαγειρικής από τα οποία μαγειρεύεις· φωτογράφισε μεμονωμένες συνταγές από τα υπόλοιπα",
      why: "Πολλά βιβλία μαγειρικής τα κρατάμε για μία-δύο συνταγές. Μια φωτογραφία κρατά τη συνταγή χωρίς να πιάνει ράφι."
    },
    {
      id: "d70-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε πετσέτες κουζίνας, γάντια φούρνου και ποδιές· κράτα όσα είναι σε καλή κατάσταση",
      why: "Τα φθαρμένα υφάσματα αντικαθίστανται εύκολα και μαζεύονται γρήγορα. Ένα μικρό φρέσκο σετ αρκεί σε κάθε κουζίνα."
    },
    {
      id: "d71-phys", level: "phys", difficulty: 1,
      title: "Κράτα μόνο τα παγούρια και τις κούπες ταξιδιού που πραγματικά κουβαλάς",
      why: "Τα δωρεάν διαφημιστικά παγούρια και κούπες μαζεύονται γρήγορα. Ένα-δύο καλά αρκούν για την καθημερινότητα."
    },
    {
      id: "d72-phys", level: "phys", difficulty: 1,
      title: "Βάλε ένα καθημερινό χρονόμετρο 15 λεπτών για τακτοποίηση αυτή την εβδομάδα",
      why: "Οι σύντομες, χρονικά περιορισμένες συνεδρίες διώχνουν το βάρος του «πρέπει να συμμαζέψω». Δεκαπέντε λεπτά τη μέρα κάνουν σχεδόν δύο ώρες την εβδομάδα."
    },
    {
      id: "d73-phys", level: "phys", difficulty: 3,
      title: "Εξέτασε τις μικρές συσκευές: ποιες δεν χρησιμοποιήθηκαν τους τελευταίους έξι μήνες;",
      why: "Αρτοπαρασκευαστές, αποχυμωτές και βαφλιέρες συχνά υπόσχονται έναν τρόπο ζωής που δεν ζούμε. Πούλησε ή χάρισε όσες μένουν αχρησιμοποίητες."
    },
    {
      id: "d74-phys", level: "phys", difficulty: 2,
      title: "Προσάρμοσε πιάτα και μαχαιροπίρουνα στον αριθμό των καλεσμένων που πραγματικά φιλοξενείς",
      why: "Σερβίτσιο για δώδεκα έχει νόημα μόνο αν φιλοξενείς δώδεκα. Κράτα όσα χρειάζεται η πραγματική σου ζωή, όχι ένα υποθετικό τραπέζι."
    },
    {
      id: "d75-phys", level: "phys", difficulty: 1,
      title: "Μάζεψε τις άδειες μπαταρίες και πήγαινέ τες σε κάδο συλλογής μπαταριών",
      why: "Οι μπαταρίες περιέχουν μέταλλα που δεν πρέπει να καταλήγουν στα κοινά σκουπίδια. Τα περισσότερα σούπερ μάρκετ και καταστήματα έχουν κάδο συλλογής."
    },
    {
      id: "d76-phys", level: "phys", difficulty: 2,
      title: "Μάζεψε αχρησιμοποίητους φορτιστές, καλώδια και παλιές συσκευές για ανακύκλωση ηλεκτρονικών",
      why: "Οι παλιές ηλεκτρονικές συσκευές περιέχουν πολύτιμα αλλά και επικίνδυνα υλικά. Σβήσε πρώτα τα προσωπικά δεδομένα και μετά πήγαινέ τες σε σημείο συλλογής ηλεκτρονικών."
    },
    {
      id: "d77-phys", level: "phys", difficulty: 1,
      title: "Δοκίμασε λάμπες και πολύπριζα· κράτα μόνο όσα λειτουργούν με ασφάλεια",
      why: "Τα φθαρμένα καλώδια είναι κίνδυνος πυρκαγιάς, και οι καμένες λάμπες είναι απλώς ακαταστασία σε ένα συρτάρι."
    },
    {
      id: "d78-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε σε βάθος την είσοδο: πάτωμα, χαλάκι, κρεμάστρες και παπουτσοθήκη",
      why: "Η είσοδος είναι το πρώτο που βλέπεις όταν γυρίζεις σπίτι. Μια καθαρή είσοδος δίνει τον τόνο σε όλο το σπίτι."
    },
    {
      id: "d79-phys", level: "phys", difficulty: 1,
      title: "Μπες σε κάθε δωμάτιο και ρώτα: τι εδώ δεν ανήκει σε αυτό το δωμάτιο;",
      why: "Με τον καιρό τα πράγματα μετακινούνται από δωμάτιο σε δωμάτιο. Όταν επιστρέφουν στο σωστό δωμάτιο, η «ακαταστασία» συχνά λύνεται αμέσως."
    },
    {
      id: "d80-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε το φαρμακείο πρώτων βοηθειών· συμπλήρωσε τα βασικά και βγάλε τα ληγμένα",
      why: "Ένα κουτί πρώτων βοηθειών είναι χρήσιμο μόνο αν μπορείς να βασιστείς σε αυτό σε ώρα ανάγκης. Τα ληγμένα φάρμακα πάνε σε φαρμακείο, όχι στα σκουπίδια."
    },
    {
      id: "d81-phys", level: "phys", difficulty: 1,
      title: "Περιόρισε κεριά και μικροδιακοσμητικά στα πραγματικά αγαπημένα σου",
      why: "Η διακόσμηση λειτουργεί καλύτερα με χώρο γύρω της. Λίγα επιλεγμένα αντικείμενα ξεχωρίζουν· πολλά ανταγωνίζονται για προσοχή."
    },
    {
      id: "d82-phys", level: "phys", difficulty: 1,
      title: "Φρόντισε τα φυτά σου ή δώσε σε άλλους όσα δεν μπορείς να φροντίσεις",
      why: "Ένα φυτό που μαραζώνει είναι μια μικρή καθημερινή επίπληξη. Ένας φίλος με το κατάλληλο φως μπορεί να το βοηθήσει να ανθίσει."
    },
    {
      id: "d83-phys", level: "phys", difficulty: 1,
      title: "Αποχωρίσου άδεια βάζα και γλάστρες που δεν χρησιμοποίησες έναν χρόνο",
      why: "Τα άδεια δοχεία μαζεύονται στα ντουλάπια «για κάποια στιγμή». Κράτα ένα-δύο και δώσε τα υπόλοιπα."
    },
    {
      id: "d84-phys", level: "phys", difficulty: 1,
      title: "Περιόρισε χαρτιά περιτυλίγματος, κορδέλες και σακουλάκια δώρων σε ένα μικρό κουτί",
      why: "Τα υλικά περιτυλίγματος απλώνονται σε όλο το σπίτι. Ένα κουτί βάζει ένα σαφές, ορατό όριο."
    },
    {
      id: "d85-phys", level: "phys", difficulty: 2,
      title: "Τακτοποίησε τα υλικά χειροτεχνίας και χόμπι· κράτα ό,τι αφορά έργα που θα ξεκινήσεις φέτος",
      why: "Τα υλικά για παρατημένα έργα κουβαλούν αθόρυβα ενοχές. Δώσ' τα σε ένα σχολείο, σε έναν φίλο ή σε μια ομάδα της γειτονιάς."
    },
    {
      id: "d86-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειασε κάθε οριζόντια επιφάνεια στο σαλόνι",
      why: "Οι οριζόντιες επιφάνειες τραβούν την ακαταστασία σαν μαγνήτες. Ένα γρήγορο εβδομαδιαίο πέρασμα τις κρατά λειτουργικές."
    },
    {
      id: "d87-phys", level: "phys", difficulty: 1,
      title: "Κράτα λίγες χάρτινες σακούλες και κούτες· ανακύκλωσε τις υπόλοιπες",
      why: "Όλοι κρατάμε μερικές «χρήσιμες» κούτες, αλλά η στοίβα τείνει να μεγαλώνει. Όρισε ένα όριο και τήρησέ το."
    },
    {
      id: "d88-phys", level: "phys", difficulty: 2,
      title: "Βγάλε ένα κουτί ή καλάθι αποθήκευσης που δεν χρειάζεσαι πια",
      why: "Περισσότερος αποθηκευτικός χώρος συχνά σημαίνει περισσότερα πράγματα. Όταν ένας χώρος αδειάσει, μπορούν να φύγουν και τα επιπλέον κουτιά."
    },
    {
      id: "d89-phys", level: "phys", difficulty: 1,
      title: "Γράψε μια απλή εβδομαδιαία λίστα καθαριότητας σε μία σελίδα",
      why: "Μια σαφής λίστα σημαίνει ότι δεν χρειάζεται να αποφασίζεις τι θα καθαρίσεις μετά. Λιγότερα πράγματα κάνουν και τη λίστα πιο σύντομη."
    },
    {
      id: "d90-phys", level: "phys", difficulty: 2,
      title: "Φινάλε ανοιξιάτικης καθαριότητας: καθάρισε σε βάθος το δωμάτιο που χρησιμοποιείς περισσότερο",
      why: "Μετά από έναν μήνα ξεκαθαρίσματος, το καθάρισμα γίνεται πολύ πιο γρήγορα. Απόλαυσε πόσο πιο εύκολο είναι με λιγότερα εμπόδια."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 91–120 · ΑΠΡΙΛΙΟΣ · Χώροι διημέρευσης & βιβλία ===== */
    {
      id: "d91-phys", level: "phys", difficulty: 3,
      title: "Ξεκίνα μια κάψουλα τριών μηνών: διάλεξε 33 κομμάτια να φοράς και φύλαξε τα υπόλοιπα",
      why: "Αυτή είναι η ιδέα του Project 333: μετράνε ρούχα, παπούτσια και αξεσουάρ· όχι εσώρουχα, πιτζάμες και αθλητικά. Δεν χρειάζεται να πετάξεις τίποτα, απλώς φύλαξέ τα."
    },
    {
      id: "d92-phys", level: "phys", difficulty: 2,
      title: "Τακτοποίησε τα βιβλία σου: κράτα όσα αγαπάς ή θα διαβάσεις φέτος",
      why: "Τα βιβλία κρατιούνται εύκολα και αποχωρίζονται δύσκολα. Ένα ράφι με βιβλία που πραγματικά εκτιμάς λέει περισσότερα από έναν τοίχο αδιάβαστων."
    },
    {
      id: "d93-phys", level: "phys", difficulty: 1,
      title: "Χάρισε βιβλία σε βιβλιοθήκη, σχολείο ή σε ένα σημείο ανταλλαγής βιβλίων της γειτονιάς",
      why: "Ένα βιβλίο στο ράφι δεν κάνει τίποτα· ένα βιβλίο στα χέρια κάποιου κάνει. Όταν χαρίζεις βιβλία, τους δίνεις νέα ζωή."
    },
    {
      id: "d94-phys", level: "phys", difficulty: 2,
      title: "Τακτοποίησε DVD, CD, βινύλια και φυσικά παιχνίδια· κράτα όσα ξαναπαίζεις",
      why: "Τα περισσότερα φυσικά μέσα είναι πλέον διαθέσιμα κατ' απαίτηση. Κράτα ό,τι έχει πραγματική αξία για σένα και δώσε τα υπόλοιπα."
    },
    {
      id: "d95-phys", level: "phys", difficulty: 2,
      title: "Τακτοποίησε τα καλώδια πίσω από την τηλεόραση ή το γραφείο και βάλε ετικέτα σε κάθε φις",
      why: "Τα μπερδεμένα καλώδια είναι οπτικός θόρυβος και δυσκολεύουν το καθάρισμα. Οι ετικέτες γλιτώνουν χρόνο όταν χρειάζεται να βγάλεις κάτι από την πρίζα."
    },
    {
      id: "d96-phys", level: "phys", difficulty: 1,
      title: "Μάζεψε όλα τα τηλεχειριστήρια· κράτα μόνο όσα αντιστοιχούν σε συσκευές που έχεις ακόμη",
      why: "Τα παλιά τηλεχειριστήρια μένουν πολύ μετά την αποχώρηση των συσκευών. Λιγότερα τηλεχειριστήρια, λιγότερη σύγχυση στον καναπέ."
    },
    {
      id: "d97-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε επιτραπέζια και παζλ για κομμάτια που λείπουν",
      why: "Ένα ελλιπές παιχνίδι δεν θα παιχτεί. Κράτα όσα είναι πλήρη και φέρνουν τους ανθρώπους κοντά."
    },
    {
      id: "d98-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά, ένα δωμάτιο, όλα πίσω στη θέση τους",
      why: "Η συνέπεια νικά την ένταση. Το ίδιο σύντομο τελετουργικό κάθε εβδομάδα διατηρεί ό,τι κέρδισες τους προηγούμενους μήνες."
    },
    {
      id: "d99-phys", level: "phys", difficulty: 1,
      title: "Βγάλε τα μισά διακοσμητικά από ένα ράφι για μία εβδομάδα και δες τι σου λείπει",
      why: "Η απουσία αποκαλύπτει την αξία. Ό,τι δεν σου λείψει σε μία εβδομάδα μάλλον δεν πρόσθετε πολλά."
    },
    {
      id: "d100-phys", level: "phys", difficulty: 2,
      title: "Ημέρα 100: φωτογράφισε κάθε δωμάτιο και σύγκρινε με το πώς ήταν τον Ιανουάριο",
      why: "Εκατό μέρες μικρών κινήσεων αθροίζονται. Οι φωτογραφίες δίπλα-δίπλα το κάνουν ορατό."
    },
    {
      id: "d101-phys", level: "phys", difficulty: 1,
      title: "Μείωσε τα διακοσμητικά μαξιλάρια και τις κουβέρτες σε όσα πραγματικά χρησιμοποιείς",
      why: "Τα πολλά μαξιλάρια καταλήγουν κάθε βράδυ στο πάτωμα. Λίγα που αγαπάς είναι πιο ζεστά και πλένονται πιο εύκολα."
    },
    {
      id: "d102-phys", level: "phys", difficulty: 2,
      title: "Εξέτασε ό,τι κρέμεται στους τοίχους· κράτα μόνο όσα χαίρεσαι να κοιτάζεις",
      why: "Οι τοίχοι είναι το φόντο της καθημερινότητας. Τα έργα και οι φωτογραφίες που αγαπάς αξίζουν χώρο, όχι συνωστισμό."
    },
    {
      id: "d103-phys", level: "phys", difficulty: 2,
      title: "Ξεχώρισε παλιές κάρτες και γράμματα· κράτα όσα πραγματικά σε συγκινούν",
      why: "Η δουλειά μιας κάρτας τελειώνει όταν διαβαστεί. Κράτα τις λίγες με αληθινά προσωπικά λόγια· ανακύκλωσε τις υπόλοιπες χωρίς ενοχές."
    },
    {
      id: "d104-phys", level: "phys", difficulty: 2,
      title: "Κράτα τα ενθύμια ταξιδιών που λένε μια ιστορία· αποχωρίσου τα υπόλοιπα",
      why: "Πολλά αναμνηστικά αγοράζονται παρορμητικά και ξεχνιούνται. Όσα ξυπνούν μια ανάμνηση μπορούν να μείνουν και να εκτεθούν."
    },
    {
      id: "d105-phys", level: "phys", difficulty: 3,
      title: "Άνοιξε ένα κουτί με αντικείμενα συναισθηματικής αξίας και αποφάσισε για καθένα",
      why: "Τα συναισθηματικά αντικείμενα είναι τα πιο δύσκολα, γι' αυτό αφήνονται για όταν έχεις εξασκηθεί στις αποφάσεις. Διάλεξε μερικούς θησαυρούς για να τους βλέπεις, αντί για ένα κουτί που δεν ανοίγεις ποτέ."
    },
    {
      id: "d106-phys", level: "phys", difficulty: 1,
      title: "Για μία εβδομάδα, σημείωνε κάθε αγορά που κάνεις εκτός από τρόφιμα",
      why: "Η επίγνωση είναι το πρώτο φίλτρο. Όταν βλέπεις τις αγορές σου σε λίστα, φαίνεται ποιες είχαν πραγματικά σημασία."
    },
    {
      id: "d107-phys", level: "phys", difficulty: 2,
      title: "Κοίτα μία συλλογή σου: είναι ακόμη χαρά ή έχει γίνει υποχρέωση;",
      why: "Οι συλλογές συχνά επιβιώνουν περισσότερο από το ενδιαφέρον που τις ξεκίνησε. Κράτα τα καλύτερα κομμάτια και απελευθερώσου από την υποχρέωση."
    },
    {
      id: "d108-phys", level: "phys", difficulty: 1,
      title: "Χάρισε παλιά γυαλιά οράσεως μέσω οπτικού καταστήματος ή φορέα που τα συλλέγει",
      why: "Τα παλιά γυαλιά μένουν χρόνια στα συρτάρια. Ορισμένα οπτικά και φιλανθρωπικές οργανώσεις τα συλλέγουν για επαναχρησιμοποίηση."
    },
    {
      id: "d109-phys", level: "phys", difficulty: 1,
      title: "Κράτα μία-δύο ομπρέλες σε καλή κατάσταση· αποχωρίσου τις χαλασμένες",
      why: "Οι ομπρέλες πληθαίνουν επειδή αγοράζουμε καινούργια κάθε φορά που ξεχνάμε τη δική μας. Όταν ξέρεις πού είναι, το πρόβλημα λύνεται."
    },
    {
      id: "d110-phys", level: "phys", difficulty: 1,
      title: "Αναγνώρισε κάθε κλειδί που έχεις· βγάλε όσα δεν ανοίγουν τίποτα",
      why: "Τα άγνωστα κλειδιά προσθέτουν βάρος και σύγχυση. Βάλε ετικέτα στα εφεδρικά που κρατάς."
    },
    {
      id: "d111-phys", level: "phys", difficulty: 1,
      title: "Μάζεψε τα σκόρπια κέρματα από βάζα και συρτάρια και ξόδεψέ τα ή κατάθεσέ τα",
      why: "Τα σκόρπια κέρματα είναι χρήματα που δεν κάνουν τίποτα. Μαζεμένα, συχνά γίνονται μια ευχάριστη έκπληξη."
    },
    {
      id: "d112-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειασε ξανά τον πάγκο της κουζίνας",
      why: "Οι επιφάνειες ξαναγεμίζουν αθόρυβα. Όταν επιστρέφεις κάθε εβδομάδα σε έναν χώρο που άδειασες, η νέα συνήθεια εδραιώνεται."
    },
    {
      id: "d113-phys", level: "phys", difficulty: 3,
      title: "Πούλησε ή χάρισε ένα έπιπλο που δεν χρησιμοποιείς ουσιαστικά",
      why: "Τα έπιπλα καθορίζουν πώς κινούμαστε σε ένα δωμάτιο. Αν φύγει ένα, μπορεί να αλλάξει η αίσθηση όλου του χώρου."
    },
    {
      id: "d114-phys", level: "phys", difficulty: 2,
      title: "Αναδιάταξε ένα δωμάτιο με βάση το πώς πραγματικά το χρησιμοποιείς",
      why: "Τα δωμάτια συνήθως στήνονται μία φορά και δεν τα ξανασκεφτόμαστε. Μια νέα διάταξη με λιγότερα κομμάτια μπορεί να κάνει τον χώρο πιο λειτουργικό."
    },
    {
      id: "d115-phys", level: "phys", difficulty: 1,
      title: "Εξέτασε χαλιά και χαλάκια· κράτα όσα είναι καθαρά και χρειάζονται",
      why: "Πολλά χαλιά κάνουν ένα δωμάτιο να μοιάζει φορτωμένο και μαζεύουν σκόνη. Λιγότερα και καλά επιλεγμένα δείχνουν πιο ήρεμα."
    },
    {
      id: "d116-phys", level: "phys", difficulty: 2,
      title: "Άδειασε το πάνω μέρος της ντουλάπας ή των ψηλών ντουλαπιών",
      why: "Ό,τι φυλάγεται ψηλά ξεχνιέται εύκολα. Αν δεν θυμόσουν ότι ήταν εκεί, μάλλον δεν το χρειάζεσαι."
    },
    {
      id: "d117-phys", level: "phys", difficulty: 2,
      title: "Άνοιξε την αποθήκη ή το υπόγειο και απλώς κατάγραψε τι υπάρχει",
      why: "Πριν αποφασίσεις, απλώς κοίτα. Μια γραπτή λίστα μετατρέπει έναν τρομακτικό χώρο σε μια σειρά διαχειρίσιμων αποφάσεων."
    },
    {
      id: "d118-phys", level: "phys", difficulty: 2,
      title: "Δώσε σε άλλους εξοπλισμό χόμπι ή αθλημάτων που δεν σου ταιριάζει πια",
      why: "Ένα όργανο ή μια ρακέτα που δεν χρησιμοποιείς πια μπορεί να ξεκινήσει το πάθος κάποιου άλλου."
    },
    {
      id: "d119-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Απριλίου: ποια απόφαση αυτόν τον μήνα ήταν η πιο δύσκολη και γιατί;",
      why: "Οι δύσκολες αποφάσεις δείχνουν πού βρίσκονται οι προσκολλήσεις σου. Όταν τις καταλαβαίνεις, οι επόμενες γίνονται πιο εύκολες."
    },
    {
      id: "d120-phys", level: "phys", difficulty: 1,
      title: "Χάρισε κλειστά προϊόντα προσωπικής υγιεινής σε ξενώνα ή κοινωνικό παντοπωλείο",
      why: "Τα αχρησιμοποίητα σαπούνια, σαμπουάν και οδοντόκρεμες είναι χρήσιμα σε ανθρώπους που τα χρειάζονται. Πολλοί τοπικοί φορείς τα δέχονται."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 121–151 · ΜΑΪΟΣ · Αποθήκη, μπαλκόνι & εργαλεία ===== */
    {
      id: "d121-phys", level: "phys", difficulty: 2,
      title: "Άδειασε το μπαλκόνι ή τον εξωτερικό σου χώρο ώστε να είναι έτοιμος για τις ζεστές μέρες",
      why: "Τα μπαλκόνια συχνά γίνονται αποθήκες. Ένα άδειο μπαλκόνι γίνεται ένα επιπλέον δωμάτιο για τους ζεστούς μήνες."
    },
    {
      id: "d122-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε τα έπιπλα εξωτερικού χώρου και βγάλε ό,τι είναι χαλασμένο ή αχρησιμοποίητο",
      why: "Οι φθαρμένες καρέκλες και τα σπασμένα τραπέζια γεμίζουν τον εξωτερικό χώρο. Λίγα γερά κομμάτια αρκούν για να τον απολαύσεις."
    },
    {
      id: "d123-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε εργαλεία κηπουρικής και άδειες γλάστρες· κράτα μόνο ό,τι χρησιμοποιείς",
      why: "Τα είδη κήπου μαζεύονται στις γωνίες. Κράτα ό,τι λειτουργεί και δώσε τις περιττές γλάστρες σε έναν γείτονα που ασχολείται με φυτά."
    },
    {
      id: "d124-phys", level: "phys", difficulty: 2,
      title: "Συγκέντρωσε την εργαλειοθήκη σου στα βασικά εργαλεία που πραγματικά χρησιμοποιείς",
      why: "Μια συμπαγής και πλήρης εργαλειοθήκη κάνει τις μικροεπισκευές πιο γρήγορες. Τα διπλά και τα εξειδικευμένα εργαλεία μπορείς να τα δανειστείς όταν χρειαστεί."
    },
    {
      id: "d125-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε το βάζο με τις βίδες, τα καρφιά και τα ανταλλακτικά",
      why: "Τα σκόρπια μικροϋλικά είναι χρήσιμα μόνο αν βρίσκεις το σωστό κομμάτι. Λίγα μικρά δοχεία με ετικέτες μετατρέπουν το χάος σε απόθεμα."
    },
    {
      id: "d126-phys", level: "phys", difficulty: 2,
      title: "Πήγαινε παλιές μπογιές, διαλυτικά και χημικά σε κατάλληλο σημείο συλλογής",
      why: "Αυτά δεν πάνε στα κοινά σκουπίδια ή στις αποχετεύσεις. Ο δήμος σου μπορεί να σου πει πού συλλέγονται τα επικίνδυνα οικιακά απόβλητα."
    },
    {
      id: "d127-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: ένα πέρασμα από την είσοδο και τον διάδρομο",
      why: "Η είσοδος μαζεύει ό,τι μπαίνει στο σπίτι. Ένα εβδομαδιαίο πέρασμα την κρατά φιλόξενη."
    },
    {
      id: "d128-phys", level: "phys", difficulty: 3,
      title: "Άδειασε εντελώς ένα ράφι της αποθήκης και αποφάσισε για κάθε αντικείμενο",
      why: "Οι αποθήκες κρατούν χρόνια αναβληθεισών αποφάσεων. Ένα ράφι κάθε φορά κάνει τη δουλειά εφικτή."
    },
    {
      id: "d129-phys", level: "phys", difficulty: 2,
      title: "Κράτα τον αθλητικό εξοπλισμό που χρησιμοποιείς· χάρισε τον υπόλοιπο σε σύλλογο ή σχολείο",
      why: "Ο εξοπλισμός για αθλήματα που σταμάτησες είναι πιο χρήσιμος σε κάποιον που παίζει σήμερα."
    },
    {
      id: "d130-phys", level: "phys", difficulty: 2,
      title: "Επισκεύασε το ποδήλατο που δεν οδηγείς ή δώσ' το σε κάποιον που θα το οδηγήσει",
      why: "Ένα ποδήλατο με ξεφούσκωτα λάστιχα είναι ακαταστασία· ένα ποδήλατο που δουλεύει είναι ελευθερία. Αποφάσισε ποιο από τα δύο θα είναι το δικό σου."
    },
    {
      id: "d131-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τον εξοπλισμό κάμπινγκ και παραλίας πριν το καλοκαίρι· επισκεύασε ή αποχωρίσου",
      why: "Είναι καλύτερα να βρεις μια σκισμένη σκηνή ή μια σπασμένη ομπρέλα τώρα παρά την πρώτη μέρα των διακοπών."
    },
    {
      id: "d132-phys", level: "phys", difficulty: 1,
      title: "Κράτα μόνο τις βαλίτσες που ταιριάζουν στον τρόπο που πραγματικά ταξιδεύεις",
      why: "Οι βαλίτσες πιάνουν πολύ χώρο για αντικείμενα που χρησιμοποιούνται λίγες φορές τον χρόνο. Φύλαξε τις μικρές μέσα στις μεγάλες."
    },
    {
      id: "d133-phys", level: "phys", difficulty: 1,
      title: "Κάνε έναν γρήγορο έλεγχο στα γιορτινά στολίδια αφού είσαι ήδη στην αποθήκη",
      why: "Είναι πιο εύκολο να αποφασίσεις ήρεμα τώρα παρά στη βιασύνη του Δεκεμβρίου. Τα χαλασμένα λαμπάκια και τα ξεθωριασμένα στολίδια μπορούν να φύγουν."
    },
    {
      id: "d134-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειασε το γραφείο και το κομοδίνο σου",
      why: "Οι προσωπικές επιφάνειες γεμίζουν πρώτες. Ένα εβδομαδιαίο άδειασμα τις κρατά λειτουργικές."
    },
    {
      id: "d135-phys", level: "phys", difficulty: 3,
      title: "Αντιμετώπισε το γκαράζ ή τη γωνιά του πάρκινγκ: χώρισε τα πάντα σε κρατάω, χαρίζω, ανακυκλώνω",
      why: "Τα γκαράζ μαζεύουν ό,τι απορρίπτει το σπίτι. Ένα καθαρό γκαράζ είναι πιο ασφαλές και πιο χρήσιμο."
    },
    {
      id: "d136-phys", level: "phys", difficulty: 1,
      title: "Άδειασε το πορτμπαγκάζ από ό,τι δεν χρειάζεται να είναι εκεί",
      why: "Το επιπλέον βάρος αυξάνει και την κατανάλωση καυσίμου. Κράτα ένα απλό κιτ έκτακτης ανάγκης και βγάλε τα υπόλοιπα."
    },
    {
      id: "d137-phys", level: "phys", difficulty: 2,
      title: "Αποχωρίσου περισσευούμενα οικοδομικά υλικά από παλιές ανακαινίσεις",
      why: "Τα περισσευούμενα πλακάκια και ξύλα κρατιούνται χρόνια «για καλό και για κακό». Κράτα λίγα για επισκευές και χάρισε τα υπόλοιπα."
    },
    {
      id: "d138-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε τα είδη των κατοικιδίων: παιχνίδια, κρεβατάκια, λουριά και παλιά τροφή",
      why: "Τα κατοικίδια χρειάζονται λιγότερα από όσα τους αγοράζουμε. Χάρισε ό,τι δεν χρησιμοποιείς σε ένα καταφύγιο ζώων."
    },
    {
      id: "d139-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε εντομοαπωθητικά και προϊόντα κήπου· απόρριψε με ασφάλεια τα παλιά",
      why: "Τα παλιά χημικά προϊόντα χάνουν την αποτελεσματικότητά τους και μπορεί να είναι επικίνδυνα. Έλεγξε την ετικέτα για οδηγίες απόρριψης."
    },
    {
      id: "d140-phys", level: "phys", difficulty: 2,
      title: "Φτιάξε ένα μικρό πράγμα που σε ενοχλεί εδώ και μήνες",
      why: "Μια πόρτα που τρίζει ή ένα χερούλι που κουνιέται είναι μια μικρή καθημερινή ενόχληση. Όταν το φτιάχνεις, φεύγει μια τριβή που είχες πάψει να προσέχεις."
    },
    {
      id: "d141-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: μία σακούλα με πράγματα φεύγει από το σπίτι αυτή την εβδομάδα",
      why: "Μια τακτική «έξοδος» κρατά τα πράγματα να φεύγουν τόσο φυσικά όσο μπαίνουν."
    },
    {
      id: "d142-phys", level: "phys", difficulty: 2,
      title: "Ανέβασε σήμερα τρία αντικείμενα προς πώληση στο διαδίκτυο",
      why: "Η πώληση ανακτά ένα μέρος της αξίας και δίνει στα πράγματα δεύτερη ζωή. Βάλε προθεσμία: ό,τι δεν πουληθεί μέχρι τον επόμενο μήνα, χαρίζεται."
    },
    {
      id: "d143-phys", level: "phys", difficulty: 1,
      title: "Πρόσφερε κάτι δωρεάν σε μια τοπική ομάδα χαρίσματος",
      why: "Όταν χαρίζεις σε έναν γείτονα, είναι γρήγορο και προσωπικό. Κάποιος κοντά σου μπορεί να χρειάζεται ακριβώς ό,τι δεν χρησιμοποιείς πια."
    },
    {
      id: "d144-phys", level: "phys", difficulty: 2,
      title: "Πάρε μέρος ή οργάνωσε μια ανταλλαγή ρούχων ή αντικειμένων με φίλους",
      why: "Οι ανταλλαγές ανανεώνουν τα πράγματά σου χωρίς να αγοράσεις κάτι καινούργιο, και είναι διασκεδαστικές."
    },
    {
      id: "d145-phys", level: "phys", difficulty: 1,
      title: "Κάνε μια λίστα με πράγματα που θα μπορούσες να δανείζεσαι ή να μοιράζεσαι με γείτονες αντί να τα έχεις",
      why: "Ένα δράπανο χρησιμοποιείται λίγα λεπτά σε όλη του τη ζωή. Όταν μοιραζόμαστε σπάνια εργαλεία, όλοι κερδίζουμε χρήματα και χώρο."
    },
    {
      id: "d146-phys", level: "phys", difficulty: 2,
      title: "Μέρα συντήρησης: καθάρισε τα φίλτρα του κλιματιστικού και λάδωσε τους μεντεσέδες που τρίζουν",
      why: "Όταν φροντίζεις ό,τι έχεις, κρατάει περισσότερο. Τα καθαρά φίλτρα βοηθούν επίσης το κλιματιστικό να λειτουργεί πιο αποδοτικά το καλοκαίρι."
    },
    {
      id: "d147-phys", level: "phys", difficulty: 1,
      title: "Άδειασε τον χώρο όπου απλώνεις τα ρούχα από ό,τι δεν χρειάζεται",
      why: "Οι απλώστρες και τα μανταλάκια απλώνονται με τον καιρό. Ένας ελεύθερος χώρος απλώματος κάνει τη μπουγάδα πιο γρήγορη."
    },
    {
      id: "d148-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: επίστρεψε όσα έχεις δανειστεί στους κατόχους τους",
      why: "Τα δανεικά ξεχνιούνται εύκολα, και δεν είναι δικά σου για να τα αποθηκεύεις. Όταν τα επιστρέφεις, ελευθερώνεις χώρο και δυναμώνεις τις σχέσεις."
    },
    {
      id: "d149-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε τα ψηλά ράφια και τα πάνω μέρη των ντουλαπιών για ξεχασμένα πράγματα",
      why: "Ό,τι φυλάγεται ψηλά συνήθως δεν χρησιμοποιείται. Κατέβασέ το και αποφάσισε."
    },
    {
      id: "d150-phys", level: "phys", difficulty: 2,
      title: "Άδειασε το δωμάτιο των επισκεπτών, τον καναπέ-κρεβάτι ή τη γωνιά που έγινε αποθήκη",
      why: "Οι χώροι των επισκεπτών τείνουν να γεμίζουν με ό,τι περισσεύει. Ένας άδειος χώρος είναι έτοιμος να υποδεχτεί ανθρώπους."
    },
    {
      id: "d151-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Μαΐου: τι έφυγε από το σπίτι αυτόν τον μήνα και τι μπήκε;",
      why: "Όταν παρακολουθείς και τις δύο κατευθύνσεις, φαίνεται αν το σπίτι σου πράγματι ελαφραίνει."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 152–181 · ΙΟΥΝΙΟΣ · Καλοκαίρι & ταξίδια ===== */
    {
      id: "d152-phys", level: "phys", difficulty: 3,
      title: "Άλλαξε την ντουλάπα σου σε καλοκαιρινή: πλύνε και φύλαξε τα βαριά χειμωνιάτικα",
      why: "Όταν φυλάς τα ρούχα καθαρά, τα προστατεύεις από σκόρο και λεκέδες. Είναι επίσης η φυσική στιγμή να αποχωριστείς όσα δεν φόρεσες."
    },
    {
      id: "d153-phys", level: "phys", difficulty: 2,
      title: "Πλύνε και φύλαξε τις χειμωνιάτικες κουβέρτες και τα παπλώματα",
      why: "Τα ογκώδη κλινοσκεπάσματα καταλαμβάνουν τις ντουλάπες. Οι σακούλες κενού ή ένα κουτί τα κρατούν συμπαγή μέχρι το φθινόπωρο."
    },
    {
      id: "d154-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τις ημερομηνίες λήξης των αντηλιακών· αντικατέστησε μόνο όσα έχουν λήξει",
      why: "Το αντηλιακό χάνει την αποτελεσματικότητά του μετά την ημερομηνία λήξης. Ένα αξιόπιστο μπουκάλι είναι καλύτερο από πέντε αμφίβολα."
    },
    {
      id: "d155-phys", level: "phys", difficulty: 1,
      title: "Ετοίμασε μια λιτή τσάντα θαλάσσης, πάντα έτοιμη",
      why: "Μια τσάντα πάντα έτοιμη κάνει τα αυθόρμητα μπάνια εύκολα. Κράτα μέσα μόνο ό,τι χρησιμοποιείς κάθε φορά."
    },
    {
      id: "d156-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: τακτοποίησε ξανά τις επιφάνειες του μπάνιου",
      why: "Το μπάνιο χρησιμοποιείται πολλές φορές τη μέρα, οπότε ξεφεύγει γρήγορα. Ένα σύντομο εβδομαδιαίο πέρασμα το κρατά εύκολο."
    },
    {
      id: "d157-phys", level: "phys", difficulty: 1,
      title: "Γράψε μια λίστα αποσκευών που θα ξαναχρησιμοποιείς για ταξίδι μόνο με χειραποσκευή",
      why: "Μια δοκιμασμένη λίστα αφαιρεί το άγχος της βαλίτσας και αποτρέπει το παραγέμισμα. Τα περισσότερα ταξίδια χρειάζονται πολύ λιγότερα από όσα νομίζουμε."
    },
    {
      id: "d158-phys", level: "phys", difficulty: 1,
      title: "Φτιάξε ένα λιτό νεσεσέρ με μικρά επαναγεμιζόμενα μπουκαλάκια",
      why: "Τα επαναγεμιζόμενα μπουκαλάκια μειώνουν τα απόβλητα και σε κρατούν στα όρια υγρών της χειραποσκευής."
    },
    {
      id: "d159-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε τα αξεσουάρ ταξιδιού: αντάπτορες, μαξιλάρια λαιμού, λουκέτα και θήκες",
      why: "Τα αξεσουάρ ταξιδιού αγοράζονται φθηνά και μαζεύονται εύκολα. Κράτα ένα από το καθένα που πραγματικά χρησιμοποιείς."
    },
    {
      id: "d160-phys", level: "phys", difficulty: 2,
      title: "Κάνε μια δοκιμαστική βαλίτσα για το επόμενο ταξίδι σου μόνο με χειραποσκευή",
      why: "Τα ελαφριά ταξίδια σημαίνουν λιγότερα να κουβαλάς, να χάνεις ή να περιμένεις. Μια δοκιμή δείχνει τι πραγματικά χρειάζεσαι."
    },
    {
      id: "d161-phys", level: "phys", difficulty: 1,
      title: "Όρισε έναν κανόνα για αναμνηστικά: μόνο εμπειρίες, φωτογραφίες ή κάτι που καταναλώνεται",
      why: "Ένα τοπικό προϊόν, μια φωτογραφία ή μια ανάμνηση δεν χρειάζονται ράφι. Είναι ένας απλός τρόπος να ταξιδεύεις χωρίς να φέρνεις ακαταστασία στο σπίτι."
    },
    {
      id: "d162-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε καλοκαιρινά καπέλα, σανδάλια και σαγιονάρες",
      why: "Τα καλοκαιρινά παπούτσια φθείρονται γρήγορα. Κράτα τα ζευγάρια που είναι άνετα και σε καλή κατάσταση."
    },
    {
      id: "d163-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειαζε το τραπέζι μετά από κάθε γεύμα αυτή την εβδομάδα",
      why: "Ένα τραπέζι που αδειάζει μετά από κάθε γεύμα δεν γίνεται ποτέ αποθήκη."
    },
    {
      id: "d164-phys", level: "phys", difficulty: 1,
      title: "Σχεδίασε να αδειάσεις το ψυγείο πριν από τις καλοκαιρινές διακοπές",
      why: "Όταν μαγειρεύεις ό,τι υπάρχει στο ψυγείο, δεν επιστρέφεις σε χαλασμένα τρόφιμα."
    },
    {
      id: "d165-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε μαγιό και γυαλιά ηλίου· κράτα όσα πραγματικά φοράς",
      why: "Τα μαγιό χάνουν την ελαστικότητά τους από τον ήλιο και το χλώριο. Δύο-τρία που εφαρμόζουν καλά αρκούν."
    },
    {
      id: "d166-phys", level: "phys", difficulty: 2,
      title: "Προετοίμασε το σπίτι για τη ζέστη: τύλιξε τα χαλιά, βγάλε τα βαριά υφάσματα",
      why: "Λιγότερα υφάσματα σημαίνουν πιο δροσερά δωμάτια και λιγότερη σκόνη. Το σπίτι αναπνέει πιο εύκολα το καλοκαίρι."
    },
    {
      id: "d167-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε φουσκωτά και παιχνίδια θαλάσσης για τρύπες· αποχωρίσου τα χαλασμένα",
      why: "Τα φουσκωτά που ξεφουσκώνουν σπάνια επισκευάζονται. Κράτα όσα είναι ακέραια."
    },
    {
      id: "d168-phys", level: "phys", difficulty: 1,
      title: "Άφησε σε εύκολη πρόσβαση μόνο τα σκεύη που χρειάζεσαι για απλά καλοκαιρινά γεύματα",
      why: "Με τη ζέστη, το μαγείρεμα απλοποιείται. Φύλαξε ό,τι δεν θα χρειαστείς μέχρι το φθινόπωρο."
    },
    {
      id: "d169-phys", level: "phys", difficulty: 1,
      title: "Βγάλε από την πρίζα συσκευές που χρησιμοποιείς σπάνια για να κόψεις την κατανάλωση σε αναμονή",
      why: "Η κατανάλωση σε αναμονή αθροίζεται μέσα στη χρονιά. Λιγότερες συσκευές στην πρίζα σημαίνουν και λιγότερα καλώδια σε κοινή θέα."
    },
    {
      id: "d170-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά στο δωμάτιο που το χρειάζεται περισσότερο",
      why: "Όταν το σπίτι σού δείχνει πού να εστιάσεις, είναι σημάδι ότι το σύστημά σου λειτουργεί."
    },
    {
      id: "d171-phys", level: "phys", difficulty: 1,
      title: "Διάλεξε το καλοκαιρινό σου ανάγνωσμα από το δικό σου ράφι αντί να αγοράσεις καινούργιο",
      why: "Πολλοί έχουμε βιβλία που αγοράσαμε και δεν διαβάσαμε ποτέ. Το καλοκαίρι είναι η τέλεια στιγμή να τα απολαύσουμε επιτέλους."
    },
    {
      id: "d172-phys", level: "phys", difficulty: 2,
      title: "Συμφώνησε έναν απλό κανόνα τάξης με όσους μένεις",
      why: "Οι κοινόχρηστοι χώροι χρειάζονται κοινούς κανόνες. Μία σαφής συμφωνία λειτουργεί καλύτερα από συνεχείς υπενθυμίσεις."
    },
    {
      id: "d173-phys", level: "phys", difficulty: 1,
      title: "Φτιάξε ένα απλό σετ για πικνίκ με αντικείμενα πολλαπλών χρήσεων",
      why: "Ένα μικρό έτοιμο σετ κάνει το φαγητό στο ύπαιθρο εύκολο και αποφεύγει τα πλαστικά μιας χρήσης."
    },
    {
      id: "d174-phys", level: "phys", difficulty: 2,
      title: "Πριν φύγεις για διακοπές, τακτοποίησε το σπίτι για να επιστρέψεις στην ηρεμία",
      why: "Όταν επιστρέφεις σε ένα καθαρό και τακτοποιημένο σπίτι, το τέλος των διακοπών είναι πιο ήπιο."
    },
    {
      id: "d175-phys", level: "phys", difficulty: 2,
      title: "Δώσε σε άλλους εποχικά αντικείμενα που δεν χρησιμοποίησες το περασμένο καλοκαίρι",
      why: "Αν κάτι έμεινε αχρησιμοποίητο ένα ολόκληρο καλοκαίρι, πιθανότατα θα κάνει το ίδιο και φέτος."
    },
    {
      id: "d176-phys", level: "phys", difficulty: 1,
      title: "Εντόπισε το σημείο που μαζεύει τη μεγαλύτερη ακαταστασία και δώσ' του έναν απλό κανόνα",
      why: "Κάθε σπίτι έχει ένα σημείο όπου η ακαταστασία επιστρέφει πάντα. Ένας σαφής κανόνας, όπως «τίποτα δεν μένει εδώ τη νύχτα», σπάει τον κύκλο."
    },
    {
      id: "d177-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειασε εντελώς την καθημερινή σου τσάντα",
      why: "Οι τσάντες γεμίζουν σιγά σιγά με αποδείξεις, περιτυλίγματα και περιττά. Όταν ξεκινάς από την αρχή, ελαφραίνουν οι ώμοι και το μυαλό σου."
    },
    {
      id: "d178-phys", level: "phys", difficulty: 1,
      title: "Κουβάλα λιγότερα αυτό το καλοκαίρι: περιόρισε την τσάντα σου στα απολύτως απαραίτητα",
      why: "Μια ελαφριά τσάντα είναι πιο άνετη στη ζέστη. Τις περισσότερες μέρες χρειάζεσαι μόνο κλειδιά, κινητό, πορτοφόλι και νερό."
    },
    {
      id: "d179-phys", level: "phys", difficulty: 2,
      title: "Ξαναδές το «κουτί του ίσως»: ό,τι δεν χρειάστηκε να ανοίξεις μπορεί να φύγει",
      why: "Ο χρόνος πήρε την απόφαση για σένα. Αν μπορείς, χάρισε το κουτί χωρίς να το ξανανοίξεις."
    },
    {
      id: "d180-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός εξαμήνου: γράψε τι έχει αλλάξει στο σπίτι και στις συνήθειές σου",
      why: "Έξι μήνες μικρών βημάτων είναι μια πραγματική μεταμόρφωση. Όταν την αναγνωρίζεις, χτίζεις κίνητρο για το δεύτερο μισό."
    },
    {
      id: "d181-phys", level: "phys", difficulty: 1,
      title: "Σχεδίασε την επόμενη κάψουλα των 33 κομματιών: τι λειτούργησε και τι όχι;",
      why: "Η προηγούμενη κάψουλα σού έδειξε τι πραγματικά φοράς. Χρησιμοποίησέ το για να επιλέξεις καλύτερα για το καλοκαίρι."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 182–212 · ΙΟΥΛΙΟΣ · Χαρτιά & έγγραφα ===== */
    {
      id: "d182-phys", level: "phys", difficulty: 3,
      title: "Ξεκίνα την καλοκαιρινή σου κάψουλα: 33 κομμάτια για τους επόμενους τρεις μήνες, τα υπόλοιπα φυλαγμένα",
      why: "Λιγότερες επιλογές κάθε πρωί σημαίνουν περισσότερη ενέργεια για τη μέρα. Φύλαξε τα υπόλοιπα μακριά από τα μάτια σου και πρόσεξε πόσο λίγο σου λείπουν."
    },
    {
      id: "d183-phys", level: "phys", difficulty: 2,
      title: "Μάζεψε σε ένα σημείο κάθε σκόρπιο χαρτί και έγγραφο του σπιτιού",
      why: "Τα χαρτιά σκορπισμένα σε όλα τα δωμάτια είναι αδύνατο να τα διαχειριστείς. Όταν τα βλέπεις όλα μαζί, κάνεις το πρώτο βήμα για ένα απλό σύστημα."
    },
    {
      id: "d184-phys", level: "phys", difficulty: 2,
      title: "Φτιάξε ένα απλό σύστημα αρχειοθέτησης με λίγες μόνο κατηγορίες",
      why: "Σπίτι, υγεία, οικονομικά, δουλειά, ταυτότητα: πέντε φάκελοι καλύπτουν τα περισσότερα νοικοκυριά. Τα απλά συστήματα χρησιμοποιούνται."
    },
    {
      id: "d185-phys", level: "phys", difficulty: 2,
      title: "Ανακύκλωσε παλιούς λογαριασμούς και καταστάσεις που δεν χρειάζεται πια να κρατάς",
      why: "Έλεγξε πόσο καιρό πρέπει να φυλάσσονται φορολογικά και οικονομικά έγγραφα εκεί που ζεις, και μετά κατέστρεψε ή ανακύκλωσε με ασφάλεια τα υπόλοιπα."
    },
    {
      id: "d186-phys", level: "phys", difficulty: 3,
      title: "Σκάναρε τα σημαντικά έγγραφα· κράτα πρωτότυπα μόνο όσων τα χρειάζονται",
      why: "Ληξιαρχικές πράξεις, συμβόλαια και τίτλοι χρειάζονται πρωτότυπα· πολλά άλλα χαρτιά χρειάζονται μόνο ένα καθαρό σκαναρισμένο αντίγραφο φυλαγμένο με ασφάλεια."
    },
    {
      id: "d187-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: επεξεργάσου ό,τι νέο χαρτί μπήκε στο σπίτι αυτή την εβδομάδα",
      why: "Τα χαρτιά μπαίνουν στο σπίτι καθημερινά. Μια εβδομαδιαία συνήθεια τα εμποδίζει να ξαναστοιβαχτούν."
    },
    {
      id: "d188-phys", level: "phys", difficulty: 1,
      title: "Κράτα εγγυήσεις για πράγματα που έχεις ακόμη· ανακύκλωσε όσες έχουν λήξει",
      why: "Μια εγγύηση είναι χρήσιμη μόνο όσο ισχύει. Ένας φάκελος για τις ενεργές εγγυήσεις αρκεί."
    },
    {
      id: "d189-phys", level: "phys", difficulty: 2,
      title: "Ξεφύλλισε παλιά τετράδια και σημειώσεις· κράτα μόνο όσα θα ξαναδιάβαζες",
      why: "Οι παλιές σημειώσεις σπάνια ξαναδιαβάζονται. Κράτα λίγα που σημαίνουν κάτι και φωτογράφισε σελίδες που θέλεις να θυμάσαι."
    },
    {
      id: "d190-phys", level: "phys", difficulty: 1,
      title: "Αποθήκευσε τις επαγγελματικές κάρτες ως επαφές στο κινητό και μετά ανακύκλωσέ τες",
      why: "Μια επαφή στο κινητό αναζητείται· μια κάρτα σε ένα συρτάρι όχι."
    },
    {
      id: "d191-phys", level: "phys", difficulty: 1,
      title: "Άλλαξε έναν έντυπο λογαριασμό ή μια κατάσταση σε ηλεκτρονική αποστολή",
      why: "Κάθε έντυπος λογαριασμός που σταματάς είναι χαρτί που δεν θα χρειαστεί ποτέ να ταξινομήσεις, να αρχειοθετήσεις ή να καταστρέψεις."
    },
    {
      id: "d192-phys", level: "phys", difficulty: 1,
      title: "Βάλε ένα σημείωμα «όχι διαφημιστικά φυλλάδια» στο γραμματοκιβώτιο",
      why: "Τα φυλλάδια είναι ακαταστασία που έρχεται απρόσκλητη. Είναι πιο εύκολο να τα σταματήσεις στην πόρτα παρά να τα ανακυκλώνεις μετά."
    },
    {
      id: "d193-phys", level: "phys", difficulty: 2,
      title: "Αν ζεις με παιδιά, φύλαξε τα μισά παιχνίδια και εναλλάσσετέ τα κάθε μήνα",
      why: "Λιγότερα παιχνίδια κάθε φορά συχνά σημαίνουν πιο ουσιαστικό παιχνίδι. Τα παιχνίδια που εναλλάσσονται μοιάζουν ξανά καινούργια."
    },
    {
      id: "d194-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: καθάρισε την πόρτα του ψυγείου από παλιά σημειώματα και φυλλάδια",
      why: "Η πόρτα του ψυγείου είναι ένας πίνακας ανακοινώσεων που δεν καθαρίζεται ποτέ. Κράτα μόνο ό,τι είναι επίκαιρο."
    },
    {
      id: "d195-phys", level: "phys", difficulty: 1,
      title: "Περιόρισε τα περισσευούμενα είδη γραφείου: μπλοκ, αυτοκόλλητα χαρτάκια, φάκελοι",
      why: "Τα είδη γραφείου είναι φθηνά και πολλαπλασιάζονται. Κράτα όσα χωράνε σε ένα συρτάρι και χάρισε τα υπόλοιπα σε σχολείο."
    },
    {
      id: "d196-phys", level: "phys", difficulty: 2,
      title: "Φτιάξε έναν φάκελο «απαραίτητα»: ταυτότητες, διαβατήρια, ασφάλειες και βασικές επαφές",
      why: "Σε μια έκτακτη ανάγκη, δεν πρέπει να ψάχνεις. Ένας φάκελος, μία γνωστή θέση."
    },
    {
      id: "d197-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τις ημερομηνίες λήξης ταυτότητας, διαβατηρίου και διπλώματος οδήγησης",
      why: "Η έγκαιρη ανανέωση αποφεύγει το άγχος της τελευταίας στιγμής πριν από ένα ταξίδι. Σημείωσε τις ημερομηνίες στο ημερολόγιό σου."
    },
    {
      id: "d198-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε χαρτιά ζωγραφικής, είδη τέχνης και μισογεμάτα μπλοκ σχεδίου",
      why: "Κράτα όσα υλικά θα χρησιμοποιήσεις και άφησε τα υπόλοιπα να εμπνεύσουν κάποιον άλλο."
    },
    {
      id: "d199-phys", level: "phys", difficulty: 1,
      title: "Χρησιμοποίησε ένα τετράδιο για όλα αντί για πολλά μισογεμάτα",
      why: "Ένα τετράδιο κουβαλιέται και ξεφυλλίζεται εύκολα. Τα σκόρπια τετράδια σκορπίζουν και τις σκέψεις σου."
    },
    {
      id: "d200-phys", level: "phys", difficulty: 2,
      title: "Ημέρα 200: βρες ένα σημείο που ξαναγέμισε και επανάφερέ το",
      why: "Η υποτροπή είναι φυσιολογική. Όταν επιστρέφεις σε έναν χώρο χωρίς ενοχές, η αλλαγή γίνεται μόνιμη."
    },
    {
      id: "d201-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: μάζεψε ό,τι έμεινε έξω από το βράδυ",
      why: "Ένα σπίτι που τακτοποιείται κάθε βράδυ ξεκινά κάθε μέρα ήρεμο."
    },
    {
      id: "d202-phys", level: "phys", difficulty: 1,
      title: "Άδειασε τον πίνακα ανακοινώσεων· κράτα μόνο ό,τι είναι επίκαιρο",
      why: "Οι παλιές ανακοινώσεις χάνουν το νόημά τους αλλά μένουν καρφιτσωμένες χρόνια. Ένας καθαρός πίνακας κάνει τις νέες πληροφορίες να ξεχωρίζουν."
    },
    {
      id: "d203-phys", level: "phys", difficulty: 1,
      title: "Άδειασε την επιφάνεια πάνω από το πλυντήριο",
      why: "Είναι μια επίπεδη επιφάνεια σε πολυσύχναστο σημείο, οπότε μαζεύει πράγματα. Όταν είναι άδεια, η μπουγάδα γίνεται πιο εύκολα."
    },
    {
      id: "d204-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε τα συμπληρώματα και τις βιταμίνες· σταμάτα να αγοράζεις όσα δεν παίρνεις",
      why: "Τα μισοτελειωμένα κουτιά συμπληρωμάτων είναι συνηθισμένα. Κράτα μόνο όσα παίρνεις σταθερά και ρώτα γιατρό αν έχεις αμφιβολίες."
    },
    {
      id: "d205-phys", level: "phys", difficulty: 2,
      title: "Τελείωσε ένα ανολοκλήρωτο έργο ή άφησέ το επίσημα",
      why: "Τα ανολοκλήρωτα έργα κρατούν και χώρο και νοητική ενέργεια. Όταν ένα ολοκληρώνεται ή εγκαταλείπεται, απελευθερώνονται και τα δύο."
    },
    {
      id: "d206-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά στην κουζίνα",
      why: "Η κουζίνα είναι το πιο πολυσύχναστο δωμάτιο. Ένα σύντομο εβδομαδιαίο reset την κρατά το πιο εύχρηστο δωμάτιο."
    },
    {
      id: "d207-phys", level: "phys", difficulty: 1,
      title: "Οργάνωσε τα έγγραφα του αυτοκινήτου σε έναν φάκελο στο ντουλαπάκι",
      why: "Ασφάλεια, άδεια κυκλοφορίας και οδική βοήθεια πρέπει να βρίσκονται εύκολα, και τα παλιά αντίγραφα να αφαιρούνται."
    },
    {
      id: "d208-phys", level: "phys", difficulty: 1,
      title: "Κράτα ένα μπουφάν ή σακάκι ανά άτομο στις κρεμάστρες της εισόδου",
      why: "Οι παραφορτωμένες κρεμάστρες κρύβουν ό,τι χρειάζεσαι. Φύλαξε τα υπόλοιπα σε μια ντουλάπα."
    },
    {
      id: "d209-phys", level: "phys", difficulty: 1,
      title: "Τελείωσε τα ανοιχτά πακέτα στο ντουλάπι πριν ανοίξεις καινούργια",
      why: "Τα ανοιχτά πακέτα μπαγιατεύουν όταν ανοίγεις νέα. Όταν τελειώνεις ό,τι είναι ανοιχτό, μειώνεις τη σπατάλη."
    },
    {
      id: "d210-phys", level: "phys", difficulty: 1,
      title: "Γράψε τι θα έπαιρνες σε μια έκτακτη ανάγκη και κράτα αυτά τα πράγματα εύκολα προσβάσιμα",
      why: "Όταν ξέρεις τι μετράει περισσότερο, βλέπεις καθαρά. Φαίνεται επίσης πόσα από τα υπόλοιπα θα μπορούσες να μην έχεις."
    },
    {
      id: "d211-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Ιουλίου: πώς νιώθεις τώρα με τα χαρτιά σου;",
      why: "Τα χαρτιά είναι από τις πιο συνηθισμένες πηγές άγχους στο σπίτι. Πρόσεξε τη διαφορά που κάνει ένα σύστημα."
    },
    {
      id: "d212-phys", level: "phys", difficulty: 3,
      title: "Ξεκίνα μια παύση 30 ημερών από τις μη απαραίτητες αγορές",
      why: "Το ξεκαθάρισμα διαρκεί μόνο αν μπαίνουν λιγότερα. Ένας μήνας χωρίς περιττές αγορές επαναφέρει τις συνήθειες και δείχνει τι πραγματικά χρειάζεσαι."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 213–243 · ΑΥΓΟΥΣΤΟΣ · Αργοί ρυθμοί & λιγότερες αγορές ===== */
    {
      id: "d213-phys", level: "phys", difficulty: 1,
      title: "Γράψε τη λίστα με τα απαραίτητα που επιτρέπονται αυτόν τον μήνα",
      why: "Τρόφιμα, φάρμακα, είδη υγιεινής που τελείωσαν, επισκευές. Μια σαφής λίστα εμποδίζει την παύση να μοιάζει με τιμωρία."
    },
    {
      id: "d214-phys", level: "phys", difficulty: 1,
      title: "Ζήτα από τα καταστήματα να σταματήσουν να σου στέλνουν έντυπους καταλόγους",
      why: "Οι κατάλογοι σχεδιάζονται για να δημιουργούν επιθυμία. Λιγότεροι στο γραμματοκιβώτιο σημαίνουν λιγότερες παρορμήσεις."
    },
    {
      id: "d215-phys", level: "phys", difficulty: 2,
      title: "Επισκεύασε ένα αντικείμενο αντί να το αντικαταστήσεις",
      why: "Η επισκευή γλιτώνει χρήματα και πόρους και χτίζει μια διαφορετική σχέση με τα πράγματά σου."
    },
    {
      id: "d216-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: μία επιφάνεια εντελώς άδεια σε κάθε δωμάτιο",
      why: "Μία άδεια επιφάνεια σε κάθε δωμάτιο αρκεί για να νιώθει κάθε δωμάτιο πιο ήρεμο."
    },
    {
      id: "d217-phys", level: "phys", difficulty: 1,
      title: "Ξεκίνα μια λίστα επιθυμιών 30 ημερών: γράψ' το και περίμενε πριν το αγοράσεις",
      why: "Οι περισσότερες επιθυμίες ξεθωριάζουν μέσα σε έναν μήνα. Ό,τι μένει στη λίστα μετά από 30 ημέρες αξίζει να το σκεφτείς."
    },
    {
      id: "d218-phys", level: "phys", difficulty: 1,
      title: "Διάλεξε μία κατηγορία, όπως σαμπουάν ή τετράδια, και τελείωσέ την πριν αγοράσεις άλλα",
      why: "Τα περισσότερα σπίτια έχουν κρυφά αποθέματα. Όταν τα τελειώνεις, κερδίζεις χρήματα και αδειάζουν τα ράφια."
    },
    {
      id: "d219-phys", level: "phys", difficulty: 1,
      title: "Δανείσου ένα βιβλίο, εργαλείο ή παιχνίδι από βιβλιοθήκη αντί να το αγοράσεις",
      why: "Οι βιβλιοθήκες σου επιτρέπουν να απολαμβάνεις πράγματα χωρίς να τα έχεις. Η πρόσβαση μετράει περισσότερο από την ιδιοκτησία."
    },
    {
      id: "d220-phys", level: "phys", difficulty: 1,
      title: "Ξαναανακάλυψε κάτι που έχεις αλλά είχες ξεχάσει",
      why: "Τα ξεχασμένα αντικείμενα είναι συχνά ακριβώς αυτά που θα αγοράζαμε ξανά. Απόλαυσε ό,τι είναι ήδη δικό σου."
    },
    {
      id: "d221-phys", level: "phys", difficulty: 2,
      title: "Μαγείρεψε για μια ολόκληρη μέρα μόνο με ό,τι υπάρχει ήδη στην κουζίνα σου",
      why: "Είναι μια δημιουργική πρόκληση που μειώνει τη σπατάλη τροφίμων και δείχνει πόσα έχεις ήδη."
    },
    {
      id: "d222-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε και φρόντισε κάτι που αγαπάς: παπούτσια, μια τσάντα, ένα μπουφάν",
      why: "Όταν φροντίζεις τα πράγματά σου, τα εκτιμάς περισσότερο και κρατούν περισσότερο."
    },
    {
      id: "d223-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: επέστρεψε κάθε πράγμα στο δωμάτιο όπου ανήκει",
      why: "Τα πράγματα μετακινούνται τις καλοκαιρινές μέρες. Ένα γρήγορο πέρασμα βάζει ξανά το σπίτι σε τάξη."
    },
    {
      id: "d224-phys", level: "phys", difficulty: 1,
      title: "Πέρασε τον ελεύθερο χρόνο σου σε έναν δωρεάν χώρο αντί για ένα κατάστημα",
      why: "Πάρκα, παραλίες, μουσεία τις μέρες ελεύθερης εισόδου: η αναψυχή δεν χρειάζεται να περιλαμβάνει αγορές."
    },
    {
      id: "d225-phys", level: "phys", difficulty: 1,
      title: "Όταν νιώσεις την παρόρμηση να αγοράσεις, γράψε τι την προκάλεσε",
      why: "Η βαρεμάρα, το άγχος και οι διαφημίσεις είναι συνηθισμένα ερεθίσματα. Όταν τους δίνεις όνομα, αδυνατίζει η επίδρασή τους."
    },
    {
      id: "d226-phys", level: "phys", difficulty: 1,
      title: "Υπολόγισε το κόστος ανά χρήση για τρία ρούχα σου",
      why: "Ένα ακριβό παλτό που φοριέται χρόνια μπορεί να κοστίζει λιγότερο ανά χρήση από ένα φθηνό πουκάμισο που φορέθηκε δύο φορές. Είναι καλύτερο μέτρο αξίας."
    },
    {
      id: "d227-phys", level: "phys", difficulty: 2,
      title: "Χάρισε κάτι που αγαπάς αλλά δεν χρησιμοποιείς σε κάποιον που θα το χρησιμοποιήσει",
      why: "Όταν ένα αγαπημένο αντικείμενο πηγαίνει στον σωστό άνθρωπο, η απώλεια γίνεται γενναιοδωρία."
    },
    {
      id: "d228-phys", level: "phys", difficulty: 1,
      title: "Απόψε, φρόντισε να μην έχει μείνει τίποτα στο πάτωμα σε ένα δωμάτιο",
      why: "Τα ελεύθερα πατώματα κάνουν ένα δωμάτιο να φαίνεται αμέσως μεγαλύτερο και καθαρίζεται πιο εύκολα."
    },
    {
      id: "d229-phys", level: "phys", difficulty: 2,
      title: "Άδειασε εντελώς το πάτωμα ενός δωματίου και κράτα το έτσι για μία εβδομάδα",
      why: "Τα πατώματα δεν είναι αποθήκη. Μια εβδομάδα πειθαρχίας σε ένα δωμάτιο χτίζει μια μόνιμη συνήθεια."
    },
    {
      id: "d230-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: τακτοποίησε την είσοδο και άδειασε τις τσάντες σου",
      why: "Τα πηγαινέλα του καλοκαιριού φέρνουν άμμο, φυλλάδια και περιττά. Ένα εβδομαδιαίο άδειασμα τα κρατά ελαφριά."
    },
    {
      id: "d231-phys", level: "phys", difficulty: 1,
      title: "Όταν κάτι χρειάζεται αντικατάσταση, ψάξε μια ανθεκτική επιλογή που επισκευάζεται",
      why: "Η σωστή αγορά μία φορά είναι ο πιο βιώσιμος μινιμαλισμός. Η ποιότητα μειώνει τη μελλοντική ακαταστασία."
    },
    {
      id: "d232-phys", level: "phys", difficulty: 1,
      title: "Ράψε ένα κουμπί που λείπει ή μπάλωσε ένα μικρό σκίσιμο",
      why: "Οι μικρές επισκευές θέλουν λίγα λεπτά και δίνουν στα ρούχα χρόνια ζωής."
    },
    {
      id: "d233-phys", level: "phys", difficulty: 1,
      title: "Διάβασε τις ετικέτες φροντίδας στα αγαπημένα σου ρούχα και πλύνε ανάλογα",
      why: "Το σωστό πλύσιμο κρατά τα ρούχα ωραία για πολύ περισσότερο, οπότε χρειάζεσαι λιγότερα."
    },
    {
      id: "d234-phys", level: "phys", difficulty: 1,
      title: "Πέρασε ένα απόγευμα στο σπίτι χωρίς να κάνεις τίποτα, σε έναν τακτοποιημένο χώρο",
      why: "Ένα τακτοποιημένο σπίτι υπάρχει για να το απολαμβάνεις. Η ξεκούραση είναι μέρος του σκοπού."
    },
    {
      id: "d235-phys", level: "phys", difficulty: 1,
      title: "Ετοίμασε από απόψε τα ρούχα και την τσάντα της επόμενης μέρας",
      why: "Η βραδινή προετοιμασία κάνει τα πρωινά ήρεμα. Είναι πιο εύκολο όταν έχεις λιγότερα, καλά επιλεγμένα πράγματα."
    },
    {
      id: "d236-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε τα φυτά του μπαλκονιού: βγάλε τα ξερά και τις άδειες γλάστρες",
      why: "Το τέλος του καλοκαιριού είναι δύσκολο για τα φυτά. Όταν καθαρίζεις ό,τι δεν επέζησε, ο χώρος ανανεώνεται."
    },
    {
      id: "d237-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά στην κρεβατοκάμαρα",
      why: "Η κρεβατοκάμαρα αξίζει να μένει ξεκούραστη. Ένα σύντομο εβδομαδιαίο reset προστατεύει τον χώρο του ύπνου σου."
    },
    {
      id: "d238-phys", level: "phys", difficulty: 2,
      title: "Δώσε σε άλλους καλοκαιρινά πράγματα που ξέρεις ότι δεν θα ξαναχρησιμοποιήσεις",
      why: "Το τέλος του καλοκαιριού είναι η καλύτερη στιγμή να αποφασίσεις, όσο θυμάσαι ακόμη τι χρησιμοποίησες."
    },
    {
      id: "d239-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τη λίστα επιθυμιών 30 ημερών: τι θέλεις ακόμη;",
      why: "Τα περισσότερα θα έχουν χάσει τη γοητεία τους. Ό,τι μένει είναι μια σκεπτόμενη επιλογή, όχι παρόρμηση."
    },
    {
      id: "d240-phys", level: "phys", difficulty: 2,
      title: "Ετοίμασε ένα συμπαγές κιτ έκτακτης ανάγκης: φακός, νερό, μπαταρίες, πρώτες βοήθειες",
      why: "Η ετοιμότητα δεν χρειάζεται πολλά πράγματα. Ένα οργανωμένο κουτί είναι καλύτερο από σκόρπια εφόδια."
    },
    {
      id: "d241-phys", level: "phys", difficulty: 3,
      title: "Απομάκρυνε εύφλεκτα άχρηστα αντικείμενα από το μπαλκόνι, την αυλή ή τον κήπο",
      why: "Τους ζεστούς και ξηρούς μήνες, σωροί από ξύλα, χαρτιά, ξερά φυτά και παλιά έπιπλα σε εξωτερικούς χώρους μπορεί να τροφοδοτήσουν φωτιά. Λιγότερη ακαταστασία σημαίνει και περισσότερη ασφάλεια."
    },
    {
      id: "d242-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Αυγούστου: τι σου έμαθε η παύση από τις αγορές;",
      why: "Πρόσεξε τι δεν σου έλειψε και πώς άλλαξαν τα έξοδά σου. Κράτα τα διδάγματα που ταιριάζουν στη ζωή σου."
    },
    {
      id: "d243-phys", level: "phys", difficulty: 1,
      title: "Στήσε ένα πρωινό σημείο με ό,τι χρειάζεσαι για να βγεις από το σπίτι",
      why: "Ένα σημείο για κλειδιά, τσάντα και καθημερινά μετατρέπει το πρωινό τρέξιμο σε ρουτίνα."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 244–273 · ΣΕΠΤΕΜΒΡΙΟΣ · Ρουτίνες & χώρος εργασίας ===== */
    {
      id: "d244-phys", level: "phys", difficulty: 2,
      title: "Άδειασε εντελώς το γραφείο σου· επέστρεψε μόνο όσα χρησιμοποιείς κάθε μέρα",
      why: "Ένα άδειο γραφείο στηρίζει τη συγκεντρωμένη δουλειά. Όλα τα υπόλοιπα μπορούν να πάνε σε ένα συρτάρι ή να φύγουν."
    },
    {
      id: "d245-phys", level: "phys", difficulty: 1,
      title: "Κράτα ένα από κάθε είδος γραφείου που χρειάζεσαι· χάρισε τα περιττά",
      why: "Είκοσι συνδετήρες αρκούν. Τα περισσευούμενα ανήκουν σε κάποιον που τα χρειάζεται τώρα."
    },
    {
      id: "d246-phys", level: "phys", difficulty: 1,
      title: "Πριν αγοράσεις σχολικά ή είδη γραφείου, έλεγξε τι έχεις ήδη",
      why: "Τα περισσότερα σπίτια έχουν αρκετά στυλό, τετράδια και φακέλους για μια ολόκληρη χρονιά. Ψώνισε πρώτα από τα συρτάρια σου."
    },
    {
      id: "d247-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειαζε το γραφείο στο τέλος κάθε εργάσιμης μέρας",
      why: "Όταν κλείνεις τη μέρα με άδειο γραφείο, το επόμενο πρωί ξεκινά πιο εύκολα."
    },
    {
      id: "d248-phys", level: "phys", difficulty: 2,
      title: "Οργάνωσε τα καλώδια που κρατάς: βάλε ετικέτες και φύλαξέ τα ανά είδος",
      why: "Όταν ξέρεις ποιο καλώδιο είναι ποιο, κερδίζεις χρόνο και αποφεύγεις τις διπλές αγορές."
    },
    {
      id: "d249-phys", level: "phys", difficulty: 1,
      title: "Ετοίμασε την τσάντα της δουλειάς ή του σχολείου μόνο με τα καθημερινά απαραίτητα",
      why: "Μια βαριά τσάντα που κουβαλάς κάθε μέρα είναι βάρος για την πλάτη και την προσοχή σου."
    },
    {
      id: "d250-phys", level: "phys", difficulty: 1,
      title: "Φτιάξε ένα σετ φαγητού πολλαπλών χρήσεων: δοχείο, μαχαιροπίρουνα, παγούρι",
      why: "Ένα απλό σετ αντικαθιστά τα καθημερινά αναλώσιμα και κάνει πιο εύκολο να παίρνεις φαγητό από το σπίτι."
    },
    {
      id: "d251-phys", level: "phys", difficulty: 1,
      title: "Βάλε έναν δίσκο εισερχομένων για τα χαρτιά στο γραφείο σου",
      why: "Ένας δίσκος μαζεύει τα πάντα μέχρι να τα επεξεργαστείς, αντί για στοίβες που απλώνονται στο γραφείο."
    },
    {
      id: "d252-phys", level: "phys", difficulty: 2,
      title: "Αναρωτήσου αν πραγματικά χρειάζεσαι εκτυπωτή στο σπίτι",
      why: "Οι εκτυπωτές πιάνουν χώρο και τα μελάνια κοστίζουν. Για περιστασιακές εκτυπώσεις, ένα κοντινό φωτοτυπείο μπορεί να αρκεί."
    },
    {
      id: "d253-phys", level: "phys", difficulty: 2,
      title: "Δώσε σε άλλους σχολικά και πανεπιστημιακά βιβλία που δεν θα ξαναχρησιμοποιήσεις",
      why: "Φοιτητές και βιβλιοθήκες συχνά τα δέχονται με χαρά. Τα παλιά σου βιβλία μπορεί να γλιτώσουν σε κάποιον χρήματα φέτος."
    },
    {
      id: "d254-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: επεξεργάσου τα χαρτιά στον δίσκο εισερχομένων",
      why: "Ο δίσκος λειτουργεί μόνο αν αδειάζει. Μία φορά την εβδομάδα, διεκπεραίωσε, αρχειοθέτησε ή ανακύκλωσε ό,τι έχει μέσα."
    },
    {
      id: "d255-phys", level: "phys", difficulty: 1,
      title: "Άδειασε τον χώρο γύρω από το πληκτρολόγιο και την οθόνη σου",
      why: "Ένας ελεύθερος χώρος εργασίας μειώνει τους περισπασμούς και διευκολύνει τη σωστή στάση του σώματος."
    },
    {
      id: "d256-phys", level: "phys", difficulty: 1,
      title: "Διάλεξε ένα εργαλείο προγραμματισμού για το σπίτι: ημερολόγιο τοίχου ή πίνακα",
      why: "Πολλά ημερολόγια ανταγωνίζονται· ένα κοινό εργαλείο κρατά όλους συγχρονισμένους."
    },
    {
      id: "d257-phys", level: "phys", difficulty: 1,
      title: "Άδειασε την κρεμάστρα του διαδρόμου πριν το φθινόπωρο",
      why: "Τα καλοκαιρινά ζακετάκια και οι τσάντες μαζεύονται δίπλα στην πόρτα. Κάνε χώρο για όσα χρειάζεται η νέα εποχή."
    },
    {
      id: "d258-phys", level: "phys", difficulty: 2,
      title: "Δώσε σε άλλους ρούχα που δεν σου κάνουν πια, σε σένα ή στην οικογένειά σου",
      why: "Τα ρούχα που μίκρυναν είναι πιο χρήσιμα τώρα, σε κάποιον που του κάνουν σήμερα."
    },
    {
      id: "d259-phys", level: "phys", difficulty: 1,
      title: "Κράτα ένα ενιαίο σετ δοχείων για προετοιμασία φαγητού",
      why: "Ένα ενιαίο σετ στοιβάζεται εύκολα και κάνει πιο εύκολο το εβδομαδιαίο μαγείρεμα."
    },
    {
      id: "d260-phys", level: "phys", difficulty: 2,
      title: "Καθάρισε σε βάθος τον φούρνο και τις εστίες",
      why: "Ένας καθαρός φούρνος είναι μια αθόρυβη απόλαυση και κάνει το μαγείρεμα πιο ελκυστικό καθώς ο καιρός δροσίζει."
    },
    {
      id: "d261-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: τακτοποίησε το σαλόνι",
      why: "Το σαλόνι είναι το σημείο όπου μαζεύεται το σπίτι. Όταν μένει τακτοποιημένο, μένει και φιλόξενο."
    },
    {
      id: "d262-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τα είδη για τη βροχή πριν το φθινόπωρο: μία ομπρέλα, ένα αδιάβροχο, ένα ζευγάρι μπότες",
      why: "Είναι καλύτερα να ξέρεις από τώρα τι λειτουργεί παρά την πρώτη βροχερή μέρα."
    },
    {
      id: "d263-phys", level: "phys", difficulty: 1,
      title: "Αν δουλεύεις από το σπίτι, μάζευε τα πράγματα της δουλειάς στο τέλος της μέρας",
      why: "Ένας ορατός υπολογιστής κρατά τη δουλειά παρούσα και το βράδυ. Όταν τον μαζεύεις, τραβάς μια σαφή γραμμή."
    },
    {
      id: "d264-phys", level: "phys", difficulty: 1,
      title: "Εξέτασε τις έντυπες συνδρομές: περιοδικά, κουτιά, τακτικές αποστολές",
      why: "Οι επαναλαμβανόμενες αποστολές φέρνουν πράγματα αυτόματα. Κράτα μόνο όσες πραγματικά περιμένεις με χαρά."
    },
    {
      id: "d265-phys", level: "phys", difficulty: 1,
      title: "Όρισε σταθερές μέρες για μπουγάδα ώστε να μη μαζεύονται στοίβες",
      why: "Ένας σταθερός ρυθμός εμποδίζει τα άπλυτα να γίνουν βουνό πάνω σε μια καρέκλα."
    },
    {
      id: "d266-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε την παπουτσοθήκη πριν το φθινόπωρο· φύλαξε τα καλοκαιρινά ζευγάρια",
      why: "Η εποχική αλλαγή κρατά την παπουτσοθήκη εύχρηστη και δείχνει τι χρειάζεται επισκευή."
    },
    {
      id: "d267-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά, μία σακούλα έξω",
      why: "Ένας σταθερός ρυθμός μικρών «εξόδων» κρατά το σπίτι σου ελαφρύτερο εβδομάδα με την εβδομάδα."
    },
    {
      id: "d268-phys", level: "phys", difficulty: 1,
      title: "Άδειασε το τραπέζι της κουζίνας ώστε να γίνει το ήρεμο κέντρο του σπιτιού",
      why: "Ένα άδειο τραπέζι είναι το σημείο όπου γίνονται σχέδια και μοιράζονται γεύματα. Κράτα το χωρίς στοίβες."
    },
    {
      id: "d269-phys", level: "phys", difficulty: 2,
      title: "Αντικατέστησε ένα φθαρμένο βασικό αντικείμενο με μια ποιοτική εκδοχή του",
      why: "Ο μινιμαλισμός δεν είναι στέρηση. Όταν επενδύεις σε κάτι που χρησιμοποιείς καθημερινά, η ζωή βελτιώνεται κάθε μέρα."
    },
    {
      id: "d270-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τον ανιχνευτή καπνού και άλλαξε την μπαταρία του αν χρειάζεται",
      why: "Ο μινιμαλισμός αφορά ό,τι έχει σημασία, και η ασφάλεια έχει τη μεγαλύτερη. Ένας ανιχνευτής που λειτουργεί είναι από τα λίγα πράγματα που χρειάζεται πραγματικά κάθε σπίτι."
    },
    {
      id: "d271-phys", level: "phys", difficulty: 2,
      title: "Ξανάδες το ντουλάπι του μπάνιου: καλοκαιρινά προϊόντα που τελείωσαν ή έληξαν",
      why: "Αντηλιακά, after-sun και μικρά ταξιδιωτικά μαζεύονται το καλοκαίρι. Καθάρισέ τα πριν την καινούργια εποχή."
    },
    {
      id: "d272-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Σεπτεμβρίου: ποια νέα ρουτίνα σε βοήθησε περισσότερο;",
      why: "Οι ρουτίνες κρατούν το σπίτι τακτοποιημένο με λίγη προσπάθεια. Πρόσεξε ποια θέλεις να κρατήσεις."
    },
    {
      id: "d273-phys", level: "phys", difficulty: 1,
      title: "Σχεδίασε τη φθινοπωρινή σου κάψουλα: τι σου έμαθε η καλοκαιρινή;",
      why: "Κάθε κάψουλα είναι ένα πείραμα. Πάρε τα διδάγματα από την προηγούμενη στην επόμενη."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 274–304 · ΟΚΤΩΒΡΙΟΣ · Φθινόπωρο & αναμνήσεις ===== */
    {
      id: "d274-phys", level: "phys", difficulty: 3,
      title: "Ξεκίνα τη φθινοπωρινή σου κάψουλα: διάλεξε 33 κομμάτια για τους επόμενους τρεις μήνες",
      why: "Μια νέα εποχή είναι ένα φυσικό reset. Διάλεξε κομμάτια που συνδυάζονται σε στρώσεις και φύλαξε τα υπόλοιπα μακριά από τα μάτια σου."
    },
    {
      id: "d275-phys", level: "phys", difficulty: 2,
      title: "Φύλαξε τα καλοκαιρινά ρούχα και αποχωρίσου όσα δεν φόρεσες φέτος το καλοκαίρι",
      why: "Αν έμεινε στην κρεμάστρα όλη την εποχή, μάλλον θα μείνει και του χρόνου."
    },
    {
      id: "d276-phys", level: "phys", difficulty: 1,
      title: "Βγάλε καθαρά φθινοπωρινά κλινοσκεπάσματα και λίγες ζεστές κουβέρτες",
      why: "Η εποχική αλλαγή κρατά τις ντουλάπες ελαφρύτερες. Μόνο ό,τι χρειάζεσαι τώρα χρειάζεται να είναι κοντά σου."
    },
    {
      id: "d277-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά για να επιστρέψουν όλα στη θέση τους",
      why: "Ο φθινοπωρινός ρυθμός ξεκινά εδώ. Τα μικρά εβδομαδιαία reset σε κρατούν σταθερό στους πολυάσχολους μήνες που έρχονται."
    },
    {
      id: "d278-phys", level: "phys", difficulty: 2,
      title: "Μάζεψε σε ένα κουτί όλες τις τυπωμένες φωτογραφίες από όλο το σπίτι",
      why: "Οι φωτογραφίες σκορπισμένες σε συρτάρια και φακέλους σπάνια τις χαιρόμαστε. Όταν τις βλέπεις μαζί, κάνεις το πρώτο βήμα."
    },
    {
      id: "d279-phys", level: "phys", difficulty: 1,
      title: "Αφαίρεσε διπλές, θολές και χωρίς νόημα τυπωμένες φωτογραφίες",
      why: "Δεν αξίζει κάθε φωτογραφία μια θέση. Όταν φεύγουν οι προφανείς, οι υπόλοιπες απολαμβάνονται πιο εύκολα."
    },
    {
      id: "d280-phys", level: "phys", difficulty: 2,
      title: "Διάλεξε τις αγαπημένες σου φωτογραφίες για ένα άλμπουμ· σκάναρε όσες άλλες θέλεις να κρατήσεις",
      why: "Ένα άλμπουμ που ανοίγεις αξίζει περισσότερο από κουτιά που δεν ανοίγεις. Τα σκαναρισμένα αντίγραφα προστατεύουν τις αναμνήσεις από απώλεια."
    },
    {
      id: "d281-phys", level: "phys", difficulty: 1,
      title: "Ανανέωσε τις κορνίζες σου: βάλε νέες αγαπημένες φωτογραφίες ή βγάλε τις άδειες",
      why: "Οι κορνίζες με παλιές φωτογραφίες χάνονται στο φόντο. Οι νέες εικόνες τις ζωντανεύουν ξανά."
    },
    {
      id: "d282-phys", level: "phys", difficulty: 2,
      title: "Εξέτασε βραβεία, κύπελλα και διπλώματα· κράτα όσα έχουν πραγματικό νόημα",
      why: "Το επίτευγμα είναι δικό σου είτε μείνει το αντικείμενο είτε όχι. Φωτογράφισε τα υπόλοιπα πριν τα αποχωριστείς."
    },
    {
      id: "d283-phys", level: "phys", difficulty: 3,
      title: "Κοίτα τα κληρονομημένα αντικείμενα: κράτα μόνο όσα θα διάλεγες κι εσύ",
      why: "Για να τιμήσεις έναν αγαπημένο άνθρωπο δεν χρειάζεται να κρατήσεις ό,τι είχε. Ένα πολύτιμο κομμάτι μπορεί να κρατήσει ολόκληρη την ανάμνηση."
    },
    {
      id: "d284-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειασε μία επιφάνεια σε κάθε δωμάτιο",
      why: "Οι επιφάνειες γεμίζουν τις πολυάσχολες εβδομάδες. Ένα γρήγορο πέρασμα διατηρεί την ηρεμία που έχτισες."
    },
    {
      id: "d285-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε εισιτήρια, προγράμματα και αναμνηστικά από εκδηλώσεις",
      why: "Κράτα λίγα που ξυπνούν έντονες αναμνήσεις· μια φωτογραφία μπορεί να κρατήσει τα υπόλοιπα."
    },
    {
      id: "d286-phys", level: "phys", difficulty: 2,
      title: "Δώσε στις αναμνήσεις σου ένα κουτί με σταθερό μέγεθος",
      why: "Ένα όριο σε κάνει να επιλέγεις, και η επιλογή κάνει κάθε αντικείμενο πιο πολύτιμο."
    },
    {
      id: "d287-phys", level: "phys", difficulty: 2,
      title: "Εξέτασε αντικείμενα από ξεχωριστές περιστάσεις: προσκλητήρια, διακοσμητικά, μπομπονιέρες",
      why: "Κράτα ένα κομμάτι με νόημα από κάθε περίσταση· τα υπόλοιπα έκαναν τη δουλειά τους."
    },
    {
      id: "d288-phys", level: "phys", difficulty: 1,
      title: "Χρησιμοποίησε τα «καλά» πιάτα ή ποτήρια που φυλάς για μια ξεχωριστή μέρα",
      why: "Τα πράγματα που φυλάμε για ειδικές περιστάσεις συχνά δεν χρησιμοποιούνται ποτέ. Και η καθημερινότητα αξίζει όμορφα πράγματα."
    },
    {
      id: "d289-phys", level: "phys", difficulty: 1,
      title: "Τακτοποίησε σχολικά λευκώματα και αναμνηστικά από παλιά χόμπι",
      why: "Κράτα ό,τι σου φέρνει χαρά όταν το ανοίγεις. Αν δεν το ανοίγεις ποτέ, ξανασκέψου το."
    },
    {
      id: "d290-phys", level: "phys", difficulty: 1,
      title: "Πριν χαρίσεις οικογενειακά αντικείμενα, ρώτα τους συγγενείς αν τα θέλουν",
      why: "Κάποιος άλλος στην οικογένεια μπορεί να εκτιμά ό,τι εσύ δεν χρειάζεσαι. Αν ρωτήσεις πρώτα, αποφεύγεις τις μεταμέλειες."
    },
    {
      id: "d291-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: βάλε στην τελική τους θέση τα αναμνηστικά που ξεχώρισες",
      why: "Οι αποφάσεις ολοκληρώνονται μόνο όταν τα πράγματα φυλαχτούν ή φύγουν. Κλείσε τον κύκλο."
    },
    {
      id: "d292-phys", level: "phys", difficulty: 2,
      title: "Πριν ξεκινήσει η θέρμανση, άδειασε τον χώρο γύρω από καλοριφέρ και θερμάστρες",
      why: "Τα αντικείμενα κοντά σε πηγές θερμότητας είναι κίνδυνος πυρκαγιάς και εμποδίζουν τη ζέστη να φτάσει στο δωμάτιο."
    },
    {
      id: "d293-phys", level: "phys", difficulty: 1,
      title: "Κράτα λίγες ζεστές κουβέρτες και χάρισε τις περισσευούμενες σε καταφύγιο ζώων",
      why: "Οι κρύες νύχτες θέλουν άνεση, όχι αποθέματα. Τα καταφύγια δέχονται με χαρά ζεστά υφάσματα."
    },
    {
      id: "d294-phys", level: "phys", difficulty: 1,
      title: "Ανανέωσε το ντουλάπι των τροφίμων για το φθινόπωρο: τελείωσε πρώτα τα καλοκαιρινά",
      why: "Το εποχικό μαγείρεμα χρησιμοποιεί φρέσκα προϊόντα και μειώνει τα αποθέματα."
    },
    {
      id: "d295-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τα χειμωνιάτικα παπούτσια και τις μπότες· επισκεύασέ τα πριν τα χρειαστείς",
      why: "Οι επισκευές θέλουν χρόνο. Αν πας τα παπούτσια στον τσαγκάρη τώρα, δεν θα αγοράσεις καινούργια βιαστικά."
    },
    {
      id: "d296-phys", level: "phys", difficulty: 1,
      title: "Ταίριαξε γάντια, κασκόλ και σκούφους· αποχωρίσου τα μονά γάντια",
      why: "Τα χειμωνιάτικα αξεσουάρ σκορπίζονται. Τα πλήρη σετ τα αρπάζεις εύκολα ένα κρύο πρωί."
    },
    {
      id: "d297-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε τα παλτά σου: κράτα όσα είναι ζεστά και φοράς",
      why: "Τα παλτά πιάνουν πολύ χώρο. Ένα-δύο καλά αρκούν στα περισσότερα κλίματα."
    },
    {
      id: "d298-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά στην είσοδο",
      why: "Το φθινόπωρο φέρνει παλτά, ομπρέλες και βρεγμένα παπούτσια. Ένα γρήγορο reset κρατά την είσοδο φιλόξενη."
    },
    {
      id: "d299-phys", level: "phys", difficulty: 1,
      title: "Γράψε την ιστορία πίσω από τα αντικείμενα συναισθηματικής αξίας που κρατάς",
      why: "Η ιστορία είναι αυτό που κάνει ένα αντικείμενο πολύτιμο. Γραμμένη, μπορεί να περάσει στους επόμενους ακόμη κι όταν το αντικείμενο δεν μπορεί."
    },
    {
      id: "d300-phys", level: "phys", difficulty: 1,
      title: "Ημέρα 300: περπάτησε σε όλο το σπίτι. Τι σε βαραίνει ακόμη;",
      why: "Μετά από τριακόσιες μέρες, το μάτι σου έχει εκπαιδευτεί. Εμπιστέψου το να εντοπίσει ό,τι έμεινε."
    },
    {
      id: "d301-phys", level: "phys", difficulty: 3,
      title: "Κάνε ένα δεύτερο πέρασμα στην αποθήκη ή στο υπόγειο",
      why: "Τα κριτήριά σου έχουν αλλάξει από την άνοιξη. Πράγματα που κράτησες τότε μπορεί να φεύγουν εύκολα τώρα."
    },
    {
      id: "d302-phys", level: "phys", difficulty: 2,
      title: "Δεύτερο πέρασμα στην κουζίνα: ποια σκεύη δεν χρησιμοποίησες από την άνοιξη;",
      why: "Έξι μήνες είναι ένα δίκαιο τεστ. Αν δεν το χρειάστηκες, πιθανότατα δεν θα το χρειαστείς."
    },
    {
      id: "d303-phys", level: "phys", difficulty: 1,
      title: "Δεύτερο πέρασμα στη βιβλιοθήκη: ποια βιβλία κράτησες αλλά δεν άνοιξες;",
      why: "Η αναγνωστική σου ζωή προχώρησε. Άφησε τα βιβλία που δεν θα διαβάσεις να βρουν νέους αναγνώστες."
    },
    {
      id: "d304-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Οκτωβρίου: τι σου έμαθε η τακτοποίηση των αναμνήσεων;",
      why: "Τα αναμνηστικά αποκαλύπτουν τι εκτιμάμε περισσότερο. Πρόσεξε τι επέλεξες να κρατήσεις."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 305–334 · ΝΟΕΜΒΡΙΟΣ · Συνειδητή προετοιμασία γιορτών ===== */
    {
      id: "d305-phys", level: "phys", difficulty: 2,
      title: "Πρότεινε μια πιο απλή ανταλλαγή δώρων σε οικογένεια ή φίλους, όπως ένας «μυστικός Άγιος Βασίλης»",
      why: "Λιγότερα και πιο προσεγμένα δώρα μειώνουν το άγχος, το κόστος και την ακαταστασία για όλους."
    },
    {
      id: "d306-phys", level: "phys", difficulty: 1,
      title: "Φτιάξε μια λίστα δώρων με έμφαση σε εμπειρίες και αναλώσιμα",
      why: "Εισιτήρια, μαθήματα, καλό φαγητό ή χρόνος μαζί είναι δώρα που δεν προσθέτουν ακαταστασία."
    },
    {
      id: "d307-phys", level: "phys", difficulty: 2,
      title: "Έλεγξε από τώρα τα γιορτινά στολίδια: κράτα όσα αγαπάς, δώσε τα υπόλοιπα",
      why: "Όταν αποφασίζεις πριν τις γιορτές, αποφεύγεις να αγοράσεις νέα στολίδια πάνω σε ξεχασμένα."
    },
    {
      id: "d308-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: ένα δωμάτιο, 10 λεπτά, όλα στη θέση τους",
      why: "Η περίοδος γίνεται πιο πολυάσχολη. Προστάτεψε την ηρεμία με μικρές, σταθερές κινήσεις."
    },
    {
      id: "d309-phys", level: "phys", difficulty: 2,
      title: "Άδειασε χώρο στην κουζίνα για το γιορτινό μαγείρεμα",
      why: "Τα μεγάλα γεύματα χρειάζονται ελεύθερους πάγκους και ντουλάπια. Όταν προετοιμάζεσαι από τώρα, οι γιορτές κυλούν πιο ομαλά."
    },
    {
      id: "d310-phys", level: "phys", difficulty: 1,
      title: "Χρειάζεσαι περισσότερα πιάτα ή καρέκλες για καλεσμένους; Δανείσου αντί να αγοράσεις",
      why: "Ό,τι αγοράζεται για ένα τραπέζι συχνά μένει αχρησιμοποίητο όλη τη χρονιά. Φίλοι και συγγενείς μπορούν να δανείσουν."
    },
    {
      id: "d311-phys", level: "phys", difficulty: 1,
      title: "Σχεδίασε να τυλίξεις τα δώρα με ό,τι έχεις ήδη ή με ύφασμα που ξαναχρησιμοποιείται",
      why: "Το χαρτί περιτυλίγματος χρησιμοποιείται για δευτερόλεπτα. Υφάσματα, μαντήλια ή ξαναχρησιμοποιημένο χαρτί είναι όμορφα και πετιούνται λιγότερα."
    },
    {
      id: "d312-phys", level: "phys", difficulty: 1,
      title: "Διάλεξε μια ιδέα για χειροποίητο ή σπιτικό δώρο",
      why: "Τα σπιτικά δώρα, όπως μπισκότα, μαρμελάδα ή ένα γράμμα, έχουν νόημα χωρίς να προσθέτουν ακαταστασία."
    },
    {
      id: "d313-phys", level: "phys", difficulty: 2,
      title: "Χάρισε ένα ζεστό παλτό που δεν φοράς σε κάποιον που το χρειάζεται",
      why: "Ο χειμώνας είναι η εποχή που τα ζεστά ρούχα μετράνε περισσότερο. Πολλοί φορείς συλλέγουν παλτά αυτή την εποχή."
    },
    {
      id: "d314-phys", level: "phys", difficulty: 1,
      title: "Πριν τις μεγάλες εκπτώσεις, γράψε τα μόνα πράγματα που πραγματικά χρειάζεσαι",
      why: "Οι εκπτώσεις σχεδιάζονται ώστε όλα να μοιάζουν επείγοντα. Μια λίστα που αποφασίστηκε από πριν προστατεύει τον προϋπολογισμό και τον χώρο σου."
    },
    {
      id: "d315-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειασε το τραπέζι και την είσοδο",
      why: "Οι καλεσμένοι και οι συγκεντρώσεις αρχίζουν να γεμίζουν το ημερολόγιο. Κράτα τους κοινόχρηστους χώρους έτοιμους."
    },
    {
      id: "d316-phys", level: "phys", difficulty: 2,
      title: "Ετοίμασε έναν τακτοποιημένο, φιλόξενο χώρο για τους επισκέπτες των γιορτών",
      why: "Ένας χώρος για επισκέπτες χωρίς στοίβες κάνει τους καλεσμένους να νιώθουν ευπρόσδεκτοι και άνετα."
    },
    {
      id: "d317-phys", level: "phys", difficulty: 2,
      title: "Αν ζεις με παιδιά, χαρίστε μαζί μερικά παιχνίδια πριν τις γιορτές",
      why: "Όταν επιλέγουν παιχνίδια για να τα χαρίσουν, τα παιδιά μαθαίνουν τη γενναιοδωρία και κάνουν χώρο για όσα έρχονται."
    },
    {
      id: "d318-phys", level: "phys", difficulty: 1,
      title: "Χάρισε ό,τι περισσεύει από τα τρόφιμα σε τράπεζα τροφίμων ή κοινωνικό παντοπωλείο",
      why: "Οι επιπλέον κονσέρβες και συσκευασίες μπορούν να γίνουν το γιορτινό τραπέζι κάποιου άλλου."
    },
    {
      id: "d319-phys", level: "phys", difficulty: 1,
      title: "Αγόραζε σε μεγάλες ποσότητες μόνο ό,τι χρησιμοποιείς σταθερά",
      why: "Οι μεγάλες συσκευασίες γλιτώνουν χρήματα μόνο αν τις τελειώνεις πριν λήξουν ή γεμίσουν την αποθήκη σου."
    },
    {
      id: "d320-phys", level: "phys", difficulty: 1,
      title: "Έλεγξε το απόθεμα με «εφεδρικά δώρα» και χρησιμοποίησέ τα ή χάρισέ τα",
      why: "Τα δώρα που αγοράζονται «για καλό και για κακό» συχνά ξεχνιούνται. Δώσ' τα τώρα, με σκοπό."
    },
    {
      id: "d321-phys", level: "phys", difficulty: 1,
      title: "Καθάρισε το ψυγείο πριν ξεκινήσει το γιορτινό μαγείρεμα",
      why: "Ένα καθαρό, μισοάδειο ψυγείο έχει χώρο για γιορτινά φαγητά και περισσεύματα."
    },
    {
      id: "d322-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: άδειασε την κουζίνα για τις εβδομάδες των γιορτών",
      why: "Οι γιορτινές προετοιμασίες κάνουν την κουζίνα καρδιά του σπιτιού. Κράτα την τακτοποιημένη και έτοιμη."
    },
    {
      id: "d323-phys", level: "phys", difficulty: 1,
      title: "Ετοίμασε καθαρά σεντόνια και πετσέτες για τους επισκέπτες",
      why: "Ένα πλήρες σετ για κάθε κρεβάτι επισκεπτών αρκεί. Δεν χρειάζεται να αγοράσεις καινούργια."
    },
    {
      id: "d324-phys", level: "phys", difficulty: 1,
      title: "Κάνε χώρο στην είσοδο για τα παλτά και τα παπούτσια των καλεσμένων",
      why: "Μια ελεύθερη είσοδος κάνει τις αφίξεις εύκολες και δείχνει φροντίδα πριν καθίσει κανείς."
    },
    {
      id: "d325-phys", level: "phys", difficulty: 1,
      title: "Επίστρεψε ή άλλαξε κλειστές αγορές όσο ακόμη μπορείς",
      why: "Οι προθεσμίες επιστροφής λήγουν αθόρυβα. Αν κινηθείς τώρα, ανακτάς χρήματα και χώρο."
    },
    {
      id: "d326-phys", level: "phys", difficulty: 1,
      title: "Σχεδίασε ένα δώρο-εμπειρία για κάποιον που αγαπάς",
      why: "Οι κοινές εμπειρίες συνήθως θυμούνται περισσότερο από τα αντικείμενα."
    },
    {
      id: "d327-phys", level: "phys", difficulty: 3,
      title: "Ξεκαθάρισε ολόκληρο ένα δωμάτιο πριν τις γιορτές",
      why: "Ένα ήρεμο δωμάτιο σου δίνει ένα καταφύγιο στις πιο πολυάσχολες εβδομάδες της χρονιάς."
    },
    {
      id: "d328-phys", level: "phys", difficulty: 1,
      title: "Ετοίμασε ένα άδειο κουτί δωρεάς για πράγματα που θα αντικατασταθούν από δώρα",
      why: "Όταν έρθουν καινούργια πράγματα, τα παλιά έχουν έτοιμη έξοδο."
    },
    {
      id: "d329-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: μία σακούλα έξω πριν τις γιορτές",
      why: "Όταν ξεκινάς την περίοδο πιο ελαφρύς/ιά, κάνεις χώρο για τους ανθρώπους και τις στιγμές που μετράνε."
    },
    {
      id: "d330-phys", level: "phys", difficulty: 1,
      title: "Εβδομάδα εκπτώσεων: αγόρασε μόνο ό,τι είναι στη λίστα σου",
      why: "Κάθε «ευκαιρία» εκτός λίστας είναι και πάλι χρήματα που ξοδεύτηκαν και χώρος που γέμισε."
    },
    {
      id: "d331-phys", level: "phys", difficulty: 1,
      title: "Πέρασε μία μέρα χωρίς να αγοράσεις τίποτα, κάνοντας κάτι δωρεάν που απολαμβάνεις",
      why: "Μια μέρα χωρίς αγορές σου θυμίζει πόσο λίγο σχετίζεται η κατανάλωση με μια καλή μέρα."
    },
    {
      id: "d332-phys", level: "phys", difficulty: 1,
      title: "Αν αγόρασες κάτι καινούργιο, άφησε ένα παρόμοιο να φύγει",
      why: "«Ένα μπαίνει, ένα βγαίνει» κρατά την ισορροπία, ακόμη και στις εκπτώσεις."
    },
    {
      id: "d333-phys", level: "phys", difficulty: 1,
      title: "Εξέτασε τις αγορές του μήνα: ποιες ήδη μετανιώνεις;",
      why: "Όταν αναγνωρίζεις νωρίς τη μεταμέλεια, μπορείς να επιστρέψεις πράγματα και να ψωνίσεις πιο προσεκτικά την επόμενη φορά."
    },
    {
      id: "d334-phys", level: "phys", difficulty: 1,
      title: "Απολογισμός Νοεμβρίου: πώς διαχειρίστηκες την πίεση για αγορές;",
      why: "Κάθε περίοδος εκπτώσεων είναι εξάσκηση. Πρόσεξε τι σε βοήθησε να μείνεις στον δρόμο σου."
    },
    /* ===== ΦΥΣΙΚΗ ΡΟΗ — ΗΜΕΡΕΣ 335–365 · ΔΕΚΕΜΒΡΙΟΣ · Γιορτές & απολογισμός ===== */
    {
      id: "d335-phys", level: "phys", difficulty: 2,
      title: "Στόλισε με λιγότερα: βάλε μόνο τα αγαπημένα σου στολίδια",
      why: "Λίγα στολίδια με νόημα δημιουργούν περισσότερη ατμόσφαιρα από κάθε κουτί αδειασμένο σε κάθε επιφάνεια."
    },
    {
      id: "d336-phys", level: "phys", difficulty: 1,
      title: "Πρόσθεσε φυσικά στολίδια: κλαδιά, κουκουνάρια, αποξηραμένα πορτοκάλια",
      why: "Τα φυσικά στολίδια είναι όμορφα, φθηνά και μπορούν να κομποστοποιηθούν μετά τις γιορτές."
    },
    {
      id: "d337-phys", level: "phys", difficulty: 2,
      title: "Αντίστροφο ημερολόγιο: βάζε ένα αντικείμενο στο κουτί δωρεάς κάθε μέρα αυτού του μήνα",
      why: "Όταν δίνεις καθημερινά, χτίζεις έναν ρυθμό γενναιοδωρίας και ένα γεμάτο κουτί ως το τέλος του Δεκεμβρίου."
    },
    {
      id: "d338-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: τακτοποίησε πριν από τις συγκεντρώσεις της εβδομάδας",
      why: "Ένα γρήγορο reset πριν έρθουν οι καλεσμένοι κάνει τη φιλοξενία χαλαρή αντί για βιαστική."
    },
    {
      id: "d339-phys", level: "phys", difficulty: 1,
      title: "Τύλιξε τα δώρα σου με ύφασμα που ξαναχρησιμοποιείται, κουτιά ή χαρτί που έχεις ήδη",
      why: "Ένα όμορφο περιτύλιγμα δεν χρειάζεται να καταλήξει στα σκουπίδια."
    },
    {
      id: "d340-phys", level: "phys", difficulty: 1,
      title: "Διάλεξε δώρα που θα καταναλωθούν ή θα βιωθούν",
      why: "Τα αναλώσιμα δώρα και οι εμπειρίες δίνουν χαρά χωρίς να χρειάζονται μόνιμη αποθήκευση."
    },
    {
      id: "d341-phys", level: "phys", difficulty: 2,
      title: "Χάρισε παιχνίδια, ρούχα ή τρόφιμα σε μια γιορτινή δράση αλληλεγγύης",
      why: "Οι γιορτές είναι η εποχή που πολλοί χρειάζονται μια μικρή βοήθεια. Ό,τι δεν χρειάζεσαι μπορεί να σημαίνει πολλά για κάποιον άλλον."
    },
    {
      id: "d342-phys", level: "phys", difficulty: 1,
      title: "Στείλε λιγότερες αλλά πιο προσωπικές γιορτινές κάρτες",
      why: "Λίγα ειλικρινή λόγια σημαίνουν περισσότερα από μια στοίβα τυπικές κάρτες."
    },
    {
      id: "d343-phys", level: "phys", difficulty: 1,
      title: "Κάνε ένα reset 15 λεπτών πριν φτάσουν οι καλεσμένοι",
      why: "Άδειες επιφάνειες και ελεύθερη είσοδος είναι ό,τι χρειάζεσαι για να υποδεχτείς τους ανθρώπους ζεστά."
    },
    {
      id: "d344-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά εκεί όπου άφησαν το σημάδι τους οι γιορτές",
      why: "Τα σύντομα reset κρατούν τη γιορτινή περίοδο χαρούμενη αντί για κουραστική."
    },
    {
      id: "d345-phys", level: "phys", difficulty: 1,
      title: "Σχεδίασε τα γιορτινά γεύματα ώστε να μην πετιέται φαγητό",
      why: "Μαγείρεψε για όσους πραγματικά θα είστε. Η αφθονία δεν χρειάζεται να καταλήγει στα σκουπίδια."
    },
    {
      id: "d346-phys", level: "phys", difficulty: 1,
      title: "Κάνε ένα σχέδιο για τα περισσεύματα: μοίρασέ τα, κατάψυξέ τα ή μαγείρεψέ τα σε νέα πιάτα",
      why: "Τα περισσεύματα είναι δώρο αν τα προγραμματίσεις. Δώσε και στους καλεσμένους να πάρουν σπίτι."
    },
    {
      id: "d347-phys", level: "phys", difficulty: 1,
      title: "Δέξου τα δώρα με χαρά· μπορείς να αποφασίσεις αργότερα τι θα κρατήσεις",
      why: "Η αποδοχή ενός δώρου αφορά τη σχέση, όχι το αντικείμενο. Οι αποφάσεις μπορούν να περιμένουν μετά τις γιορτές."
    },
    {
      id: "d348-phys", level: "phys", difficulty: 2,
      title: "Για κάθε νέο δώρο που κρατάς, άφησε ένα παλαιότερο αντικείμενο να φύγει",
      why: "Οι νέες αφίξεις είναι η τέλεια στιγμή να αποχωριστείς ό,τι αντικαθιστούν."
    },
    {
      id: "d349-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: επανάφερε την ηρεμία στο σπίτι μετά τις γιορτές",
      why: "Μετά την κορύφωση της περιόδου, ένα reset σε βοηθά να ξεκουραστείς."
    },
    {
      id: "d350-phys", level: "phys", difficulty: 1,
      title: "Πέρασε ένα βράδυ με το φως των κεριών, χωρίς οθόνες και χωρίς δουλειές",
      why: "Ένα ήρεμο σπίτι απολαμβάνεται καλύτερα με αργούς ρυθμούς. Άφησε το απλό βράδυ να είναι η γιορτή."
    },
    {
      id: "d351-phys", level: "phys", difficulty: 2,
      title: "Φύλαξε τα στολίδια σε μικρό χώρο και αποχωρίσου τα χαλασμένα",
      why: "Μάζεψε μόνο όσα θα χρησιμοποιήσεις με χαρά του χρόνου, με καθαρές ετικέτες."
    },
    {
      id: "d352-phys", level: "phys", difficulty: 1,
      title: "Ανακύκλωσε αμέσως περιτυλίγματα, κουτιά και συσκευασίες",
      why: "Οι συσκευασίες μαζεύονται γρήγορα μετά τις γιορτές. Καθάρισέ τες πριν γίνουν μέρος της επίπλωσης."
    },
    {
      id: "d353-phys", level: "phys", difficulty: 2,
      title: "Διαδρομή δωρεάς τέλους χρονιάς: πάρε ό,τι έχει το κουτί δωρεάς",
      why: "Όταν κλείνεις τη χρονιά χωρίς τίποτα να περιμένει να φύγει, ο Ιανουάριος ξεκινά από καθαρή σελίδα."
    },
    {
      id: "d354-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: 10 λεπτά για να κλείσει η χρονιά",
      why: "Ένα τελευταίο μικρό τελετουργικό πριν ξεκινήσει η νέα χρονιά."
    },
    {
      id: "d355-phys", level: "phys", difficulty: 2,
      title: "Κάνε ένα τελευταίο ξεκαθάρισμα χαρτιών πριν τη νέα χρονιά",
      why: "Διεκπεραίωσε τους τελευταίους λογαριασμούς και τα χαρτιά της χρονιάς ώστε ο Ιανουάριος να ξεκινήσει καθαρός."
    },
    {
      id: "d356-phys", level: "phys", difficulty: 1,
      title: "Μάζεψε τις σημαντικές αποδείξεις της χρονιάς σε έναν φάκελο για τη φορολογική δήλωση",
      why: "Η φορολογική δήλωση είναι πιο εύκολη όταν όλα βρίσκονται ήδη σε ένα σημείο."
    },
    {
      id: "d357-phys", level: "phys", difficulty: 2,
      title: "Φωτογράφισε κάθε δωμάτιο και σύγκρινε με το πώς ήταν πριν από έναν χρόνο",
      why: "Μια χρονιά καθημερινών βημάτων αθροίζεται σε κάτι που μπορείς να δεις. Αφιέρωσε μια στιγμή να το εκτιμήσεις."
    },
    {
      id: "d358-phys", level: "phys", difficulty: 1,
      title: "Γράψε πέντε πράγματα που αποχωρίστηκες φέτος και δεν σου λείπουν καθόλου",
      why: "Το ότι δεν σου λείπουν είναι η απόδειξη. Θυμήσου το την επόμενη φορά που μια απόφαση θα φαίνεται δύσκολη."
    },
    {
      id: "d359-phys", level: "phys", difficulty: 1,
      title: "Γράψε τις συνήθειες που θέλεις να κρατήσεις την επόμενη χρονιά",
      why: "Οι συνήθειες είναι αυτές που κρατούν ένα σπίτι ελαφρύ. Διάλεξε τις λίγες που λειτούργησαν καλύτερα για σένα."
    },
    {
      id: "d360-phys", level: "phys", difficulty: 1,
      title: "Εβδομαδιαίο reset: ένα ήρεμο σπίτι για τις τελευταίες μέρες της χρονιάς",
      why: "Απόλαυσε τον χώρο που δημιούργησες. Είναι έτοιμος για ό,τι έρθει."
    },
    {
      id: "d361-phys", level: "phys", difficulty: 1,
      title: "Διάλεξε τον έναν χώρο στον οποίο θέλεις να εστιάσεις την επόμενη χρονιά",
      why: "Όπως και τον Ιανουάριο, ένας σαφής πρώτος στόχος κάνει πιο εύκολο το ξεκίνημα της νέας χρονιάς."
    },
    {
      id: "d362-phys", level: "phys", difficulty: 2,
      title: "Καθάρισε σε βάθος την είσοδο για να υποδεχτείς τη νέα χρονιά",
      why: "Πολλές παραδόσεις θέλουν το σπίτι καθαρό πριν την Πρωτοχρονιά. Μια φρέσκια είσοδος είναι ένα ζεστό καλωσόρισμα."
    },
    {
      id: "d363-phys", level: "phys", difficulty: 1,
      title: "Άδειασε το ψυγείο για να κάνεις χώρο για την παραμονή της Πρωτοχρονιάς",
      why: "Όταν τελειώνεις ό,τι υπάρχει πριν το γιορτινό τραπέζι, αποφεύγεις τη σπατάλη και κάνεις χώρο για τη γιορτή."
    },
    {
      id: "d364-phys", level: "phys", difficulty: 1,
      title: "Κλείσε τον κύκλο: άδειασε εντελώς ένα συρτάρι, όπως την Ημέρα 1",
      why: "Η ίδια μικρή κίνηση μοιάζει διαφορετική μετά από μια χρονιά εξάσκησης. Πρόσεξε πόσο εύκολη έχει γίνει."
    },
    {
      id: "d365-phys", level: "phys", difficulty: 1,
      title: "Ευχαρίστησε το σπίτι σου: περπάτησε σε αυτό και πρόσεξε τι αγαπάς",
      why: "Ο μινιμαλισμός δεν αφορούσε ποτέ το άδειο. Αφορούσε το να κάνεις χώρο για ό,τι έχει σημασία. Απόλαυσέ το."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 1–31 · ΙΑΝΟΥΑΡΙΟΣ · Κινητό & ειδοποιήσεις ===== */
    {
      id: "d1-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τις ειδοποιήσεις μιας εφαρμογής που δεν έχει ποτέ κάτι επείγον",
      why: "Κάθε ειδοποίηση είναι μια διακοπή που επέλεξε κάποιος άλλος για σένα. Αν ξεκινήσεις από μία εφαρμογή, θα δεις πόσο λίγο σου λείπει."
    },
    {
      id: "d2-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε εφαρμογές που δεν άνοιξες τον τελευταίο μήνα",
      why: "Οι αχρησιμοποίητες εφαρμογές πιάνουν χώρο, στέλνουν ειδοποιήσεις και μπορεί να συλλέγουν δεδομένα στο παρασκήνιο. Μπορείς πάντα να τις ξαναεγκαταστήσεις."
    },
    {
      id: "d3-dig", level: "dig", difficulty: 2,
      title: "Περιόρισε την αρχική οθόνη σε μία σελίδα με χρήσιμα εργαλεία",
      why: "Η αρχική οθόνη είναι αυτό που βλέπεις δεκάδες φορές τη μέρα. Εκεί ανήκουν εργαλεία όπως χάρτες και ημερολόγιο, όχι ατελείωτες ροές."
    },
    {
      id: "d4-dig", level: "dig", difficulty: 1,
      title: "Μετακίνησε τις εφαρμογές κοινωνικών δικτύων από την αρχική οθόνη σε έναν φάκελο",
      why: "Λίγη τριβή κάνει μεγάλη διαφορά. Όταν πρέπει να ψάξεις μια εφαρμογή, η αυτόματη συνήθεια γίνεται συνειδητή επιλογή."
    },
    {
      id: "d5-dig", level: "dig", difficulty: 1,
      title: "Άνοιξε την αναφορά χρόνου οθόνης και σημείωσε τις τρεις εφαρμογές που χρησιμοποιείς περισσότερο",
      why: "Δεν μπορείς να αλλάξεις κάτι που δεν μετράς. Οι αριθμοί συχνά εκπλήσσουν."
    },
    {
      id: "d6-dig", level: "dig", difficulty: 1,
      title: "Προγραμμάτισε μια νυχτερινή λειτουργία «Μην ενοχλείτε» ή «Εστίαση»",
      why: "Ο ύπνος σου αξίζει προστασία. Άφησε να περνούν οι κλήσεις από τα αγαπημένα και σίγασε τα υπόλοιπα."
    },
    {
      id: "d7-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσες φορές περίπου έπιασες το κινητό σου αυτή την εβδομάδα;",
      why: "Πολλά κινητά μετρούν πόσες φορές τα σηκώνεις. Και μόνο η επίγνωση συχνά μειώνει τον αριθμό."
    },
    {
      id: "d8-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τα κόκκινα σήματα ειδοποιήσεων στις μη απαραίτητες εφαρμογές",
      why: "Οι κόκκινες τελείες σχεδιάζονται ώστε να νιώθεις ότι κάτι μένει εκκρεμές. Όταν φεύγουν, φεύγει και η φαγούρα."
    },
    {
      id: "d9-dig", level: "dig", difficulty: 1,
      title: "Δοκίμασε τη λειτουργία αποχρώσεων του γκρι στο κινητό σου για μία μέρα",
      why: "Το χρώμα κάνει τις οθόνες πιο ελκυστικές. Σε γκρι, το κινητό γίνεται εργαλείο και όχι φρουτάκι."
    },
    {
      id: "d10-dig", level: "dig", difficulty: 2,
      title: "Φόρτισε απόψε το κινητό σου έξω από την κρεβατοκάμαρα",
      why: "Όταν το κινητό δεν είναι δίπλα σου, και ο ύπνος και το ξύπνημα γίνονται πιο ήρεμα."
    },
    {
      id: "d11-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε ένα απλό ξυπνητήρι αντί για το κινητό",
      why: "Αν το κινητό είναι το ξυπνητήρι σου, είναι και το πρώτο που ελέγχεις. Ένα ξεχωριστό ξυπνητήρι σπάει αυτόν τον δεσμό."
    },
    {
      id: "d12-dig", level: "dig", difficulty: 1,
      title: "Κρύψε τις προεπισκοπήσεις μηνυμάτων στην οθόνη κλειδώματος για τις «θορυβώδεις» εφαρμογές",
      why: "Οι προεπισκοπήσεις σε τραβούν μέσα πριν αποφασίσεις να ασχοληθείς. Όταν τις κρύβεις, παίρνεις πίσω την επιλογή και προστατεύεις την ιδιωτικότητά σου."
    },
    {
      id: "d13-dig", level: "dig", difficulty: 1,
      title: "Σίγασε τις ομαδικές συνομιλίες που σπάνια έχουν κάτι επείγον",
      why: "Μπορείς ακόμη να τις διαβάζεις όποτε θέλεις. Η σίγαση μετατρέπει μια ροή από «μπιπ» σε κάτι που ελέγχεις με τους δικούς σου όρους."
    },
    {
      id: "d14-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια αλλαγή αυτής της εβδομάδας σε έκανε να νιώσεις καλύτερα;",
      why: "Όταν προσέχεις τι λειτουργεί, είναι πιο εύκολο να το κρατήσεις. Χτίσε πάνω σε ό,τι ήδη σε κάνει να νιώθεις καλά."
    },
    {
      id: "d15-dig", level: "dig", difficulty: 2,
      title: "Διέγραψε ένα παιχνίδι που παίζεις από συνήθεια κι όχι από ευχαρίστηση",
      why: "Κάποια παιχνίδια σχεδιάζονται για να σε κάνουν να επιστρέφεις, όχι για να σε διασκεδάζουν. Αν μοιάζει με υποχρέωση και όχι με διασκέδαση, άφησέ το."
    },
    {
      id: "d16-dig", level: "dig", difficulty: 2,
      title: "Αντικατέστησε μία εφαρμογή με την έκδοσή της στον browser",
      why: "Ο browser προσθέτει λίγη τριβή και λιγότερες ειδοποιήσεις. Έχεις ακόμη πρόσβαση, απλώς με λιγότερη έλξη."
    },
    {
      id: "d17-dig", level: "dig", difficulty: 3,
      title: "Αφαίρεσε μια εφαρμογή κοινωνικής δικτύωσης από το κινητό σου για μία εβδομάδα",
      why: "Μια εβδομάδα είναι αρκετή για να δεις τη διαφορά και αρκετά σύντομη για να μοιάζει εφικτή. Μπορείς ακόμη να μπαίνεις από υπολογιστή."
    },
    {
      id: "d18-dig", level: "dig", difficulty: 1,
      title: "Όρισε ένα ημερήσιο χρονικό όριο για την εφαρμογή που χρησιμοποιείς περισσότερο",
      why: "Ένα όριο που βάζεις σε μια ήρεμη στιγμή σε βοηθά τις στιγμές που η θέληση είναι χαμηλή."
    },
    {
      id: "d19-dig", level: "dig", difficulty: 2,
      title: "Πέρασε τα πρώτα 30 λεπτά της μέρας χωρίς κινητό",
      why: "Αυτό που βλέπεις πρώτο δίνει τον τόνο. Ξεκίνα με τις δικές σου σκέψεις και όχι με των άλλων."
    },
    {
      id: "d20-dig", level: "dig", difficulty: 2,
      title: "Πέρασε τα τελευταία 30 λεπτά πριν τον ύπνο χωρίς οθόνες",
      why: "Οι οθόνες διεγείρουν το μυαλό τη στιγμή που πρέπει να χαλαρώνει. Διάβασε, κάνε διατάσεις ή κουβέντα."
    },
    {
      id: "d21-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: σύγκρινε τον χρόνο οθόνης σου με την προηγούμενη εβδομάδα",
      why: "Οι τάσεις μετράνε περισσότερο από τις μεμονωμένες μέρες. Να χαίρεσαι για κάθε βήμα προς το λιγότερο."
    },
    {
      id: "d22-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε από την αρχική οθόνη τα widgets που δεν χρησιμοποιείς",
      why: "Τα widgets προβάλλουν συνεχώς πληροφορίες που δεν ζήτησες. Κράτα μόνο όσα σου γλιτώνουν χρόνο."
    },
    {
      id: "d23-dig", level: "dig", difficulty: 1,
      title: "Διάλεξε μια ήρεμη, απλή ταπετσαρία οθόνης",
      why: "Ένα φορτωμένο φόντο κάνει και την οθόνη φορτωμένη. Ένα ήρεμο φόντο είναι μια μικρή καθημερινή ανάσα."
    },
    {
      id: "d24-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε την αυτόματη αναπαραγωγή στις εφαρμογές βίντεο",
      why: "Η αυτόματη αναπαραγωγή αποφασίζει για σένα όταν τελειώνει ένα επεισόδιο. Χωρίς αυτή, επιλέγεις εσύ αν θα συνεχίσεις."
    },
    {
      id: "d25-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τη δόνηση για τις μη απαραίτητες ειδοποιήσεις",
      why: "Τις δονήσεις τις νιώθεις ακόμη κι όταν τις αγνοείς. Κράτησέ τες μόνο για ανθρώπους και πράγματα που μετράνε."
    },
    {
      id: "d26-dig", level: "dig", difficulty: 1,
      title: "Φάε ένα γεύμα σήμερα χωρίς κινητό πάνω στο τραπέζι",
      why: "Ένα κινητό στο τραπέζι, ακόμη και γυρισμένο ανάποδα, μοιράζει την προσοχή. Τα γεύματα είναι καλύτερα όταν είσαι εκεί ολόκληρος/η."
    },
    {
      id: "d27-dig", level: "dig", difficulty: 2,
      title: "Άφησε το κινητό στο σπίτι για μια σύντομη βόλτα",
      why: "Θυμήσου πώς είναι να μην είσαι διαθέσιμος/η για είκοσι λεπτά. Ο κόσμος θα περιμένει."
    },
    {
      id: "d28-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια εφαρμογή ανοίγεις όταν βαριέσαι;",
      why: "Όταν ξέρεις το συνηθισμένο σου «καταφύγιο», μπορείς να διαλέξεις ένα καλύτερο ή απλώς να μείνεις με τη στιγμή."
    },
    {
      id: "d29-dig", level: "dig", difficulty: 2,
      title: "Εξέτασε ποιες εφαρμογές επιτρέπεται να στέλνουν ειδοποιήσεις· ομαδοποίησε τις υπόλοιπες σε προγραμματισμένη σύνοψη",
      why: "Πολλά κινητά μπορούν να συγκεντρώνουν τις μη επείγουσες ειδοποιήσεις σε σύνοψη σε συγκεκριμένες ώρες. Λιγότερες διακοπές, ίδια ενημέρωση."
    },
    {
      id: "d30-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε παλιά φωνητικά μηνύματα και το ιστορικό κλήσεων",
      why: "Τα παλιά φωνητικά μηνύματα είναι ξεχασμένες εκκρεμότητες. Άκουσε, κάνε ό,τι χρειάζεται ή διέγραψε."
    },
    {
      id: "d31-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Ιανουαρίου: σύγκρινε τον χρόνο οθόνης αυτής της εβδομάδας με την πρώτη εβδομάδα του μήνα",
      why: "Ένας μήνας μικρών αλλαγών μπορεί να αλλάξει αισθητά τις συνήθειές σου. Γράψε τι θέλεις να κρατήσεις."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 32–59 · ΦΕΒΡΟΥΑΡΙΟΣ · Email ===== */
    {
      id: "d32-dig", level: "dig", difficulty: 1,
      title: "Σημείωσε πόσα αδιάβαστα email έχεις, χωρίς να κρίνεις",
      why: "Ένας αριθμός δίνει ένα σημείο εκκίνησης. Αυτόν τον μήνα, το inbox σου γίνεται εργαλείο αντί για βάρος."
    },
    {
      id: "d33-dig", level: "dig", difficulty: 2,
      title: "Κάνε διαγραφή από δέκα newsletters που δεν διαβάζεις πια",
      why: "Κάθε διαγραφή είναι μια μικρή απόφαση που αποδίδει κάθε εβδομάδα. Χρησιμοποίησε τον σύνδεσμο στο κάτω μέρος του email."
    },
    {
      id: "d34-dig", level: "dig", difficulty: 3,
      title: "Αρχειοθέτησε με μία κίνηση κάθε email παλαιότερο των 30 ημερών",
      why: "Αν κάτι παλιό ήταν πραγματικά επείγον, θα το ήξερες ήδη. Τα αρχειοθετημένα email μένουν αναζητήσιμα· το inbox σου ξεκινά από την αρχή."
    },
    {
      id: "d35-dig", level: "dig", difficulty: 1,
      title: "Περιόρισε τους φακέλους ή τις ετικέτες του email σου σε λίγους",
      why: "Τα περίπλοκα συστήματα φακέλων κοστίζουν περισσότερο χρόνο από όσο γλιτώνουν. Η αναζήτηση κάνει το μεγαλύτερο μέρος της δουλειάς."
    },
    {
      id: "d36-dig", level: "dig", difficulty: 2,
      title: "Φτιάξε ένα φίλτρο που στέλνει αποδείξεις και επιβεβαιώσεις παραγγελιών σε έναν φάκελο",
      why: "Οι αποδείξεις αξίζει να φυλάσσονται αλλά όχι να τις βλέπεις. Τα φίλτρα τις κρατούν προσβάσιμες και εκτός δρόμου."
    },
    {
      id: "d37-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τις ειδοποιήσεις email στο κινητό σου",
      why: "Το email σπάνια είναι επείγον. Όταν το ελέγχεις όποτε επιλέγεις εσύ, προστατεύεις τη συγκέντρωσή σου."
    },
    {
      id: "d38-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσα email ήρθαν αυτή την εβδομάδα που δεν χρειαζόσουν;",
      why: "Κάθε περιττό email είναι υποψήφιο για διαγραφή συνδρομής ή για φίλτρο."
    },
    {
      id: "d39-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε το email σε δύο-τρεις συγκεκριμένες ώρες σήμερα αντί για συνέχεια",
      why: "Όταν ομαδοποιείς το email, δεκάδες διακοπές γίνονται λίγες συγκεντρωμένες συνεδρίες."
    },
    {
      id: "d40-dig", level: "dig", difficulty: 1,
      title: "Απάντησε αμέσως σε κάθε email που θέλει λιγότερο από δύο λεπτά",
      why: "Οι σύντομες απαντήσεις που αφήνονται για μετά θέλουν περισσότερη ενέργεια για να τις θυμάσαι παρά για να τις γράψεις."
    },
    {
      id: "d41-dig", level: "dig", difficulty: 2,
      title: "Βρες και διέγραψε email με μεγάλα συνημμένα που δεν χρειάζεσαι πια",
      why: "Τα παλιά συνημμένα πιάνουν τον περισσότερο χώρο σε ένα γραμματοκιβώτιο. Αποθήκευσε πρώτα ό,τι έχει σημασία στα αρχεία σου."
    },
    {
      id: "d42-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τις ειδοποιήσεις email από τα κοινωνικά δίκτυα",
      why: "Τα κοινωνικά δίκτυα σου στέλνουν email για να σε φέρουν πίσω. Θα δεις τις ενημερώσεις όταν επιλέξεις να μπεις."
    },
    {
      id: "d43-dig", level: "dig", difficulty: 1,
      title: "Απλοποίησε την υπογραφή του email σου",
      why: "Μια σύντομη υπογραφή μόνο με τα απαραίτητα δείχνει πιο επαγγελματική από μια μεγάλη με banners."
    },
    {
      id: "d44-dig", level: "dig", difficulty: 1,
      title: "Άδειασε τον φάκελο με τα πρόχειρα του email σου",
      why: "Τα πρόχειρα είναι ανολοκλήρωτες αποφάσεις. Στείλε ό,τι έχει σημασία και διέγραψε τα υπόλοιπα."
    },
    {
      id: "d45-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πώς νιώθεις με το inbox σου σε σχέση με την αρχή του μήνα;",
      why: "Πρόσεξε τη διαφορά και στους αριθμούς και στο συναίσθημα. Αυτό είναι το πραγματικό μέτρο."
    },
    {
      id: "d46-dig", level: "dig", difficulty: 1,
      title: "Γράψε πιο σύντομα email: στόχευσε σε πέντε προτάσεις ή λιγότερες",
      why: "Τα σύντομα email διαβάζονται πιο γρήγορα και απαντώνται πιο σύντομα. Η συντομία σέβεται τον χρόνο όλων."
    },
    {
      id: "d47-dig", level: "dig", difficulty: 1,
      title: "Ζήτα να αφαιρεθείς από αλληλογραφίες που δεν χρειάζεται να παρακολουθείς",
      why: "Όταν σε βάζουν σε κοινοποίηση «για καλό και για κακό», το inbox σου γεμίζει με συζητήσεις άλλων."
    },
    {
      id: "d48-dig", level: "dig", difficulty: 3,
      title: "Συγκέντρωσε το email σου: σταμάτα να χρησιμοποιείς μια παλιά διεύθυνση και προώθησέ τη στην κύρια",
      why: "Κάθε επιπλέον λογαριασμός είναι ένα ακόμη inbox για έλεγχο. Η προώθηση σε κρατά διαθέσιμο/η ενώ απλοποιεί τα πράγματα."
    },
    {
      id: "d49-dig", level: "dig", difficulty: 1,
      title: "Έλεγξε τον φάκελο ανεπιθύμητων για κάτι σημαντικό και μετά άδειασέ τον",
      why: "Μια γρήγορη ματιά αποτρέπει τα χαμένα μηνύματα· το άδειασμα αφαιρεί την παλιά ακαταστασία."
    },
    {
      id: "d50-dig", level: "dig", difficulty: 1,
      title: "Αποθήκευσε πρότυπα για τις απαντήσεις που γράφεις πιο συχνά",
      why: "Οι επαναλαμβανόμενες απαντήσεις δεν χρειάζεται να ξαναγράφονται. Τα πρότυπα γλιτώνουν χρόνο χωρίς να χάνεται η ζεστασιά."
    },
    {
      id: "d51-dig", level: "dig", difficulty: 2,
      title: "Καθάρισε τις επαφές σου: ένωσε τις διπλές, διέγραψε αριθμούς που δεν αναγνωρίζεις",
      why: "Μια καθαρή λίστα επαφών κάνει την εύρεση ανθρώπων γρήγορη και κρατά την ατζέντα του κινητού αξιόπιστη."
    },
    {
      id: "d52-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια συνήθεια στο email εδραιώνεται;",
      why: "Οι συνήθειες εδραιώνονται όταν είναι απλές. Κράτα αυτή που λειτουργεί και άφησε αυτή που δεν λειτουργεί."
    },
    {
      id: "d53-dig", level: "dig", difficulty: 1,
      title: "Θύμισε στον εαυτό σου ότι δεν χρειάζεται κάθε μήνυμα άμεση απάντηση",
      why: "Οι άμεσες απαντήσεις μαθαίνουν τους άλλους να τις περιμένουν. Μια σκεπτόμενη απάντηση λίγες ώρες μετά είναι συνήθως καλύτερη."
    },
    {
      id: "d54-dig", level: "dig", difficulty: 1,
      title: "Βασίσου στην αναζήτηση αντί να αρχειοθετείς προσεκτικά κάθε email",
      why: "Η σύγχρονη αναζήτηση είναι γρήγορη και ακριβής. Αρχειοθέτα ελεύθερα και ψάξε όταν χρειαστεί."
    },
    {
      id: "d55-dig", level: "dig", difficulty: 1,
      title: "Κράτα μόνο τα newsletters που πραγματικά περιμένεις με χαρά",
      why: "Λίγα καλά newsletters είναι απόλαυση. Δεκάδες είναι αγγαρεία."
    },
    {
      id: "d56-dig", level: "dig", difficulty: 2,
      title: "Απάντησε σε ένα email που περιμένει πολύ καιρό",
      why: "Μια απάντηση που εκκρεμεί πολύ βαραίνει κάθε μέρα περισσότερο. Όταν τη στέλνεις, ακόμη και σύντομα, φεύγει το βάρος."
    },
    {
      id: "d57-dig", level: "dig", difficulty: 1,
      title: "Σκέψου να απενεργοποιήσεις τις ενδείξεις ανάγνωσης και πληκτρολόγησης αν σου δημιουργούν πίεση",
      why: "Όταν φαίνεσαι «online» ή «διαβάστηκε», μπορεί να νιώθεις υποχρεωμένος/η να απαντήσεις αμέσως. Εσύ ορίζεις τον ρυθμό."
    },
    {
      id: "d58-dig", level: "dig", difficulty: 1,
      title: "Αρχειοθέτησε παλιές συνομιλίες στις εφαρμογές μηνυμάτων",
      why: "Οι συζητήσεις που τελείωσαν δεν χρειάζεται να βρίσκονται στην κορυφή. Οι αρχειοθετημένες συνομιλίες είναι εκεί αν τις χρειαστείς."
    },
    {
      id: "d59-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Φεβρουαρίου: σύγκρινε τα αδιάβαστα με την αρχή του μήνα",
      why: "Ένα πιο ήρεμο inbox είναι από τις πιο αισθητές ψηφιακές νίκες. Κράτα τις συνήθειες που σε έφεραν εδώ."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 60–90 · ΜΑΡΤΙΟΣ · Αρχεία & cloud ===== */
    {
      id: "d60-dig", level: "dig", difficulty: 2,
      title: "Καθάρισε την επιφάνεια εργασίας του υπολογιστή: μετακίνησε τα πάντα σε έναν φάκελο",
      why: "Μια γεμάτη επιφάνεια εργασίας είναι οπτικός θόρυβος κάθε φορά που ανοίγεις τον υπολογιστή. Ξεκίνα καθαρά και ταξινόμησε αργότερα."
    },
    {
      id: "d61-dig", level: "dig", difficulty: 2,
      title: "Ταξινόμησε τον φάκελο «Λήψεις»: κράτα, μετακίνησε ή διέγραψε",
      why: "Οι «Λήψεις» είναι το μέρος όπου τα αρχεία πάνε για να ξεχαστούν. Φρόντισε ό,τι έχει σημασία και διέγραψε τα υπόλοιπα."
    },
    {
      id: "d62-dig", level: "dig", difficulty: 2,
      title: "Απεγκατάστησε προγράμματα του υπολογιστή που δεν χρησιμοποιείς πια",
      why: "Το αχρησιμοποίητο λογισμικό πιάνει χώρο, καθυστερεί την εκκίνηση και μπορεί να έχει κενά ασφαλείας χωρίς ενημερώσεις."
    },
    {
      id: "d63-dig", level: "dig", difficulty: 2,
      title: "Απλοποίησε τη δομή των φακέλων σε λίγους βασικούς φακέλους",
      why: "Τα βαθιά, περίπλοκα δέντρα φακέλων κάνουν τα αρχεία δύσκολα στην εύρεση. Λίγες σαφείς κατηγορίες συντηρούνται πιο εύκολα."
    },
    {
      id: "d64-dig", level: "dig", difficulty: 1,
      title: "Μετονόμασε δέκα αρχεία με σαφή ονόματα που ξεκινούν με ημερομηνία (ΕΕΕΕ-ΜΜ-ΗΗ)",
      why: "Η ημερομηνία στην αρχή ταξινομεί αυτόματα τα αρχεία με σειρά. Τα σαφή ονόματα κάνουν την αναζήτηση να λειτουργεί."
    },
    {
      id: "d65-dig", level: "dig", difficulty: 2,
      title: "Βρες και διέγραψε διπλά αρχεία",
      why: "Τα διπλά αρχεία σπαταλούν χώρο και προκαλούν σύγχυση για το ποια έκδοση είναι η τρέχουσα."
    },
    {
      id: "d66-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσο χρόνο σου παίρνει να βρεις ένα αρχείο που χρειάζεσαι;",
      why: "Η γρήγορη εύρεση είναι ο σκοπός κάθε συστήματος αρχείων. Αν αργεί, απλοποίησε περισσότερο."
    },
    {
      id: "d67-dig", level: "dig", difficulty: 1,
      title: "Άδειασε τον κάδο ανακύκλωσης του υπολογιστή σου",
      why: "Τα διαγραμμένα αρχεία πιάνουν ακόμη χώρο μέχρι να αδειάσει ο κάδος."
    },
    {
      id: "d68-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε τι πιάνει τον περισσότερο χώρο στην αποθήκευση cloud",
      why: "Συχνά λίγα μεγάλα αρχεία ή παλιά αντίγραφα ασφαλείας πιάνουν τον περισσότερο χώρο. Αν τα αφαιρέσεις, ίσως γλιτώσεις μια πληρωμένη συνδρομή."
    },
    {
      id: "d69-dig", level: "dig", difficulty: 3,
      title: "Διάλεξε μία κύρια υπηρεσία cloud και μετέφερε εκεί τα αρχεία από τις υπόλοιπες",
      why: "Τα αρχεία σκορπισμένα σε πολλές υπηρεσίες είναι δύσκολο να βρεθούν και εύκολο να χαθούν. Ένα σπίτι για τα αρχεία σου απλοποιεί τα πάντα."
    },
    {
      id: "d70-dig", level: "dig", difficulty: 2,
      title: "Εξέτασε τους κοινόχρηστους συνδέσμους και φακέλους· αφαίρεσε πρόσβαση που δεν χρειάζεται πια",
      why: "Οι παλιοί κοινόχρηστοι σύνδεσμοι μπορεί να εκθέτουν αρχεία σε ανθρώπους με τους οποίους δεν συνεργάζεσαι πια."
    },
    {
      id: "d71-dig", level: "dig", difficulty: 1,
      title: "Άδειασε τον φάκελο με τα στιγμιότυπα οθόνης",
      why: "Τα στιγμιότυπα τραβιούνται για μια στιγμή και κρατιούνται χρόνια. Διέγραψε όσα έκαναν τη δουλειά τους."
    },
    {
      id: "d72-dig", level: "dig", difficulty: 1,
      title: "Έλεγξε τον αποθηκευτικό χώρο του κινητού και αφαίρεσε τα μεγαλύτερα που δεν χρειάζεσαι",
      why: "Οι ρυθμίσεις αποθήκευσης δείχνουν τι πιάνει χώρο. Παλιά βίντεο, podcasts και αποθηκευμένα πολυμέσα είναι συνήθως οι ένοχοι."
    },
    {
      id: "d73-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: τακτοποίησε ξανά την επιφάνεια εργασίας",
      why: "Η επιφάνεια εργασίας μένει καθαρή μόνο με μια εβδομαδιαία συνήθεια. Ένα λεπτό αρκεί."
    },
    {
      id: "d74-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε επεκτάσεις του browser που δεν χρησιμοποιείς",
      why: "Οι επεκτάσεις μπορεί να διαβάζουν την περιήγησή σου και να καθυστερούν τον browser. Κράτα μόνο όσες εμπιστεύεσαι και χρησιμοποιείς."
    },
    {
      id: "d75-dig", level: "dig", difficulty: 2,
      title: "Καθάρισε τους σελιδοδείκτες σου: διέγραψε νεκρούς συνδέσμους και όσους δεν επισκέπτεσαι ποτέ",
      why: "Οι σελιδοδείκτες μαζεύονται ως «για αργότερα» που δεν έρχεται ποτέ. Κράτα μια σύντομη λίστα που πραγματικά χρησιμοποιείς."
    },
    {
      id: "d76-dig", level: "dig", difficulty: 1,
      title: "Κλείσε όλες τις καρτέλες του browser· αποθήκευσε μόνο τις λίγες που χρειάζεσαι",
      why: "Οι ανοιχτές καρτέλες είναι ανολοκλήρωτες σκέψεις. Όταν τις κλείνεις, καθαρίζει και η μνήμη του υπολογιστή και το μυαλό σου."
    },
    {
      id: "d77-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε περιττά προγράμματα που ξεκινούν μαζί με τον υπολογιστή",
      why: "Λιγότερα προγράμματα στην εκκίνηση σημαίνουν πιο γρήγορο και πιο ήσυχο υπολογιστή."
    },
    {
      id: "d78-dig", level: "dig", difficulty: 2,
      title: "Αρχειοθέτησε τα ολοκληρωμένα έργα σε έναν φάκελο «Αρχείο»",
      why: "Η ολοκληρωμένη δουλειά δεν χρειάζεται να βρίσκεται δίπλα στην ενεργή. Ένα αρχείο την κρατά ασφαλή και εκτός δρόμου."
    },
    {
      id: "d79-dig", level: "dig", difficulty: 2,
      title: "Μάζεψε παλιά USB sticks και κάρτες μνήμης· αντίγραψε ό,τι έχει σημασία και σβήσε τα",
      why: "Οι μικροί δίσκοι κρύβουν ξεχασμένα αρχεία και χάνονται εύκολα. Συγκέντρωσε, μετά ξαναχρησιμοποίησε ή ανακύκλωσέ τα."
    },
    {
      id: "d80-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: τακτοποίησε ξανά τον φάκελο «Λήψεις»",
      why: "Οι «Λήψεις» γεμίζουν γρήγορα. Ένα εβδομαδιαίο πέρασμα δύο λεπτών τις κρατά διαχειρίσιμες."
    },
    {
      id: "d81-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε τις φωνητικές σημειώσεις σου",
      why: "Οι φωνητικές σημειώσεις καταγράφονται γρήγορα και ξεχνιούνται εύκολα. Κατάγραψε γραπτώς ό,τι έχει σημασία και διέγραψε τα υπόλοιπα."
    },
    {
      id: "d82-dig", level: "dig", difficulty: 2,
      title: "Πέρασε από την εφαρμογή σημειώσεων και διέγραψε όσες σημειώσεις έχουν παλιώσει",
      why: "Οι παλιές λίστες και οι μισές ιδέες θάβουν τις σημειώσεις που έχουν σημασία. Κράτα μόνο ό,τι είναι ακόμη χρήσιμο."
    },
    {
      id: "d83-dig", level: "dig", difficulty: 1,
      title: "Γράψε έναν απλό κανόνα ονοματοδοσίας αρχείων και εφάρμοσέ τον από τώρα",
      why: "Η συνέπεια κάνει τα αρχεία εύκολα στην εύρεση χωρίς να χρειάζεται να θυμάσαι πού τα έβαλες."
    },
    {
      id: "d84-dig", level: "dig", difficulty: 1,
      title: "Όρισε προεπιλεγμένες θέσεις αποθήκευσης ώστε τα νέα αρχεία να πηγαίνουν στο σωστό σημείο",
      why: "Όταν τα αρχεία καταλήγουν αυτόματα στον σωστό φάκελο, η ακαταστασία δεν ξεκινά ποτέ."
    },
    {
      id: "d85-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε παλιά αρχεία εγκατάστασης που έχεις ήδη χρησιμοποιήσει",
      why: "Τα αρχεία εγκατάστασης χρειάζονται μία φορά. Μετά την εγκατάσταση, απλώς πιάνουν χώρο."
    },
    {
      id: "d86-dig", level: "dig", difficulty: 1,
      title: "Ενημέρωσε το λειτουργικό σύστημα και τις εφαρμογές σου",
      why: "Οι ενημερώσεις κλείνουν κενά ασφαλείας. Οι ενημερωμένες συσκευές είναι από τους πιο απλούς τρόπους να μένεις ασφαλής."
    },
    {
      id: "d87-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: κλείσε όλες τις καρτέλες στο τέλος της εβδομάδας",
      why: "Ένας καθαρός browser τη Δευτέρα είναι ένα καθαρό ξεκίνημα της εβδομάδας."
    },
    {
      id: "d88-dig", level: "dig", difficulty: 3,
      title: "Έλεγξε ότι έχεις αντίγραφο ασφαλείας των σημαντικών σου αρχείων που λειτουργεί",
      why: "Ένας συνηθισμένος πρακτικός κανόνας είναι το 3-2-1: τρία αντίγραφα, σε δύο είδη αποθήκευσης, το ένα εκτός σπιτιού ή στο cloud."
    },
    {
      id: "d89-dig", level: "dig", difficulty: 2,
      title: "Δοκίμασε το αντίγραφο ασφαλείας επαναφέροντας ένα αρχείο",
      why: "Ένα αντίγραφο ασφαλείας που δεν δοκίμασες ποτέ είναι ελπίδα, όχι σχέδιο. Η επαναφορά ενός αρχείου αποδεικνύει ότι λειτουργεί."
    },
    {
      id: "d90-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Μαρτίου: πόσο αποθηκευτικό χώρο ελευθέρωσες αυτόν τον μήνα;",
      why: "Ο ελεύθερος χώρος είναι απόδειξη προόδου, και οι συσκευές σου μάλλον τρέχουν και πιο γρήγορα."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 91–120 · ΑΠΡΙΛΙΟΣ · Φωτογραφίες & πολυμέσα ===== */
    {
      id: "d91-dig", level: "dig", difficulty: 1,
      title: "Δες πόσες φωτογραφίες έχει η βιβλιοθήκη φωτογραφιών σου",
      why: "Οι περισσότεροι έχουν χιλιάδες. Όταν ξέρεις τον αριθμό, κάνεις το πρώτο βήμα για μια βιβλιοθήκη που πραγματικά απολαμβάνεις."
    },
    {
      id: "d92-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε 100 προφανείς φωτογραφίες: θολές, διπλές και τυχαίες λήψεις",
      why: "Όταν ξεκινάς από τα προφανή, αφήνεις πίσω την τελειομανία. Ό,τι μένει φαίνεται και απολαμβάνεται πιο εύκολα."
    },
    {
      id: "d93-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε τα στιγμιότυπα οθόνης από τη βιβλιοθήκη φωτογραφιών",
      why: "Τα στιγμιότυπα είναι συνήθως προσωρινά: ένας κωδικός, μια διεύθυνση, ένα αστείο. Η δουλειά τους έχει τελειώσει."
    },
    {
      id: "d94-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε την αναζήτηση διπλότυπων της εφαρμογής φωτογραφιών, αν υπάρχει",
      why: "Πολλές εφαρμογές φωτογραφιών εντοπίζουν αυτόματα τα διπλότυπα. Άφησε το εργαλείο να κάνει το κουραστικό κομμάτι."
    },
    {
      id: "d95-dig", level: "dig", difficulty: 1,
      title: "Από κάθε σειρά παρόμοιων φωτογραφιών, κράτα μόνο την καλύτερη",
      why: "Δέκα σχεδόν ίδιες λήψεις της ίδιας στιγμής δεν κάνουν την ανάμνηση πιο δυνατή. Μια εξαιρετική φωτογραφία την κάνει."
    },
    {
      id: "d96-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πώς νιώθεις τώρα όταν ξεφυλλίζεις τις φωτογραφίες σου;",
      why: "Μια πιο ελαφριά βιβλιοθήκη είναι πιο ευχάριστη στο ξεφύλλισμα. Αυτός είναι όλος ο σκοπός."
    },
    {
      id: "d97-dig", level: "dig", difficulty: 2,
      title: "Ταξινόμησε τα βίντεο κατά μέγεθος και διέγραψε μεγάλα βίντεο που δεν θα ξαναδείς",
      why: "Τα βίντεο πιάνουν πολύ περισσότερο χώρο από τις φωτογραφίες. Λίγες διαγραφές μπορούν να ελευθερώσουν gigabytes."
    },
    {
      id: "d98-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε την αυτόματη αποθήκευση πολυμέσων που λαμβάνεις στις εφαρμογές μηνυμάτων",
      why: "Αλλιώς κάθε meme και κάθε προωθημένο βίντεο καταλήγει στη συλλογή σου. Αποθήκευε μόνο ό,τι επιλέγεις."
    },
    {
      id: "d99-dig", level: "dig", difficulty: 2,
      title: "Καθάρισε τα μεγάλα πολυμέσα από τον χώρο αποθήκευσης των εφαρμογών μηνυμάτων",
      why: "Οι εφαρμογές συνομιλιών έχουν εργαλεία αποθήκευσης που δείχνουν ποιες συζητήσεις πιάνουν τον περισσότερο χώρο."
    },
    {
      id: "d100-dig", level: "dig", difficulty: 1,
      title: "Ημέρα 100: διάλεξε τις δέκα αγαπημένες σου φωτογραφίες της χρονιάς μέχρι τώρα",
      why: "Όταν διαλέγεις αγαπημένες, εκπαιδεύεις το μάτι σου σε ό,τι πραγματικά μετράει. Αυτές είναι οι φωτογραφίες που αξίζει να έχεις κοντά σου."
    },
    {
      id: "d101-dig", level: "dig", difficulty: 2,
      title: "Φτιάξε άλμπουμ μόνο για τις πιο σημαντικές στιγμές σου",
      why: "Λίγα άλμπουμ με νόημα ξαναβλέπονται πιο εύκολα από χιλιάδες αταξινόμητες εικόνες."
    },
    {
      id: "d102-dig", level: "dig", difficulty: 1,
      title: "Όρισε μια εβδομαδιαία συνήθεια πέντε λεπτών για διαγραφή περιττών φωτογραφιών",
      why: "Οι φωτογραφίες μαζεύονται καθημερινά. Μια μικρή εβδομαδιαία συνήθεια αποτρέπει ένα ακόμη μεγάλο ξεκαθάρισμα."
    },
    {
      id: "d103-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πέντε λεπτά ξεκαθάρισμα φωτογραφιών",
      why: "Κράτα τη συνήθεια ζωντανή. Οι πρόσφατες φωτογραφίες είναι οι πιο εύκολες στην απόφαση."
    },
    {
      id: "d104-dig", level: "dig", difficulty: 3,
      title: "Βεβαιώσου ότι οι φωτογραφίες σου έχουν αντίγραφο ασφαλείας σε τουλάχιστον δύο σημεία",
      why: "Οι φωτογραφίες είναι συχνά τα πιο αναντικατάστατα δεδομένα μας. Ένα κινητό μπορεί να χαθεί σε ένα δευτερόλεπτο."
    },
    {
      id: "d105-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε φωτογραφίες από αποδείξεις, σημειώσεις και θέσεις στάθμευσης που δεν χρειάζεσαι πια",
      why: "Οι φωτογραφίες που χρησιμοποιούνται ως υπενθυμίσεις ξεπερνούν γρήγορα τον σκοπό τους. Καθάρισέ τες."
    },
    {
      id: "d106-dig", level: "dig", difficulty: 2,
      title: "Πάρε τις φωτογραφίες από παλιά κινητά ή κάμερες πριν τα ανακυκλώσεις",
      why: "Οι παλιές συσκευές συχνά κρύβουν ξεχασμένες αναμνήσεις. Μετέφερέ τες στην κύρια βιβλιοθήκη σου και μετά καθάρισε τη συσκευή."
    },
    {
      id: "d107-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε από τη μουσική σου βιβλιοθήκη όσα δεν ακούς ποτέ",
      why: "Μια εστιασμένη βιβλιοθήκη κάνει πιο εύκολο να βρίσκεις ό,τι αγαπάς."
    },
    {
      id: "d108-dig", level: "dig", difficulty: 1,
      title: "Κάνε διαγραφή από podcasts με συσσωρευμένα επεισόδια που δεν άκουσες",
      why: "Μια ατελείωτη ουρά επεισοδίων γίνεται λίστα υποχρεώσεων. Κράτα μόνο τις εκπομπές που περιμένεις με χαρά."
    },
    {
      id: "d109-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε κατεβασμένα βίντεο και σειρές που έχεις ήδη δει",
      why: "Τα αποθηκευμένα offline ξεχνιούνται εύκολα και πιάνουν πολύ χώρο."
    },
    {
      id: "d110-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πέντε λεπτά ξεκαθάρισμα φωτογραφιών και πολυμέσων",
      why: "Η μικρή, τακτική τακτοποίηση κρατά τη βιβλιοθήκη πολυμέσων σου διαχειρίσιμη για πάντα."
    },
    {
      id: "d111-dig", level: "dig", difficulty: 1,
      title: "Περιόρισε τη λίστα παρακολούθησης στο streaming σε όσα πραγματικά θέλεις να δεις",
      why: "Οι μεγάλες λίστες προκαλούν κόπωση αποφάσεων. Μια σύντομη λίστα κάνει την επιλογή ευχάριστη."
    },
    {
      id: "d112-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε από τις συσκευές σου ηλεκτρονικά βιβλία και audiobooks που τελείωσες ή δεν θέλεις",
      why: "Μια ψηφιακή βιβλιοθήκη μπορεί να είναι τόσο ακατάστατη όσο και μια φυσική. Κράτα ό,τι διαβάζεις ή θα διαβάσεις."
    },
    {
      id: "d113-dig", level: "dig", difficulty: 2,
      title: "Τύπωσε ένα μικρό άλμπουμ με τις αγαπημένες σου φωτογραφίες",
      why: "Οι τυπωμένες φωτογραφίες φαίνονται και μοιράζονται. Ένα μικρό επιλεγμένο άλμπουμ φέρνει τις ψηφιακές σου αναμνήσεις ξανά στη ζωή."
    },
    {
      id: "d114-dig", level: "dig", difficulty: 1,
      title: "Πριν μοιραστείς δημόσια φωτογραφίες, έλεγξε αν αποκαλύπτουν την τοποθεσία σου",
      why: "Οι φωτογραφίες μπορεί να περιέχουν δεδομένα τοποθεσίας, και το φόντο μπορεί να δείχνει πού μένεις. Ένας γρήγορος έλεγχος προστατεύει την ιδιωτικότητά σου."
    },
    {
      id: "d115-dig", level: "dig", difficulty: 1,
      title: "Αποχώρησε από κοινόχρηστα άλμπουμ που δεν είναι πια ενεργά",
      why: "Τα παλιά κοινόχρηστα άλμπουμ συνεχίζουν να στέλνουν ενημερώσεις και να πιάνουν χώρο. Αποθήκευσε ό,τι θέλεις και αποχώρησε."
    },
    {
      id: "d116-dig", level: "dig", difficulty: 2,
      title: "Κάνε ένα σχέδιο για να ψηφιοποιήσεις παλιά οικογενειακά βίντεο ή κασέτες",
      why: "Τα παλιά μέσα φθείρονται και οι συσκευές αναπαραγωγής εξαφανίζονται. Ένα σχέδιο τώρα προστατεύει τις αναμνήσεις για αργότερα."
    },
    {
      id: "d117-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσος ελεύθερος χώρος υπάρχει τώρα στο κινητό σου;",
      why: "Ο ελεύθερος χώρος είναι το ορατό αποτέλεσμα μιας αόρατης δουλειάς. Κράτα τον έτσι με μικρές συνήθειες."
    },
    {
      id: "d118-dig", level: "dig", difficulty: 1,
      title: "Τράβηξε σήμερα μία καλή φωτογραφία αντί για είκοσι",
      why: "Λιγότερες φωτογραφίες σημαίνουν περισσότερη προσοχή στην ίδια τη στιγμή και λιγότερα για ταξινόμηση μετά."
    },
    {
      id: "d119-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε αποθηκευμένα memes και τυχαίες κατεβασμένες εικόνες από τη συλλογή σου",
      why: "Ήταν αστεία κάποτε. Τώρα θάβουν τις φωτογραφίες που έχουν σημασία."
    },
    {
      id: "d120-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Απριλίου: πόσες φωτογραφίες αφαίρεσες και πώς νιώθεις τη βιβλιοθήκη σου;",
      why: "Μια επιλεγμένη βιβλιοθήκη λέει την ιστορία σου πιο καθαρά. Χάρου τη διαφορά."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 121–151 · ΜΑΪΟΣ · Κοινωνικά δίκτυα & ειδήσεις ===== */
    {
      id: "d121-dig", level: "dig", difficulty: 1,
      title: "Κάνε μια λίστα με κάθε πλατφόρμα κοινωνικής δικτύωσης όπου έχεις λογαριασμό",
      why: "Πολλοί έχουμε περισσότερους λογαριασμούς από όσους θυμόμαστε. Η λίστα είναι ο χάρτης σου για αυτόν τον μήνα."
    },
    {
      id: "d122-dig", level: "dig", difficulty: 1,
      title: "Για κάθε πλατφόρμα, γράψε μία πρόταση για την αξία που σου προσφέρει",
      why: "Αν δεν μπορείς να ονομάσεις ένα σαφές όφελος, ίσως η πλατφόρμα παίρνει περισσότερα από όσα δίνει."
    },
    {
      id: "d123-dig", level: "dig", difficulty: 2,
      title: "Σταμάτα να ακολουθείς 20 λογαριασμούς που δεν σε ενημερώνουν, δεν σε εμπνέουν ούτε σε συνδέουν πραγματικά",
      why: "Η ροή σου είναι διατροφή για το μυαλό σου. Διάλεξε τι μπαίνει μέσα."
    },
    {
      id: "d124-dig", level: "dig", difficulty: 1,
      title: "Σίγασε λέξεις-κλειδιά ή θέματα που σε αναστατώνουν επανειλημμένα",
      why: "Οι περισσότερες πλατφόρμες επιτρέπουν να σιγάσεις λέξεις και θέματα. Μπορείς να μένεις ενημερωμένος/η χωρίς συνεχή έκθεση."
    },
    {
      id: "d125-dig", level: "dig", difficulty: 2,
      title: "Γύρνα σε χρονολογική ροή ή σε ροή «μόνο όσοι ακολουθώ», όπου είναι δυνατό",
      why: "Οι αλγοριθμικές ροές ρυθμίζονται για να σε κρατούν, όχι για την ευεξία σου. Μια χρονολογική ροή έχει φυσικό τέλος."
    },
    {
      id: "d126-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε όλες τις ειδοποιήσεις από τις εφαρμογές κοινωνικής δικτύωσης",
      why: "Οι εφαρμογές κοινωνικής δικτύωσης σε ειδοποιούν για να σε φέρουν πίσω. Μπες όταν αποφασίζεις εσύ, όχι όταν σε καλούν."
    },
    {
      id: "d127-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πώς νιώθεις τη ροή σου μετά τις αλλαγές της εβδομάδας;",
      why: "Μια επιλεγμένη ροή πρέπει να είναι πιο ήρεμη και πιο χρήσιμη. Συνέχισε τις ρυθμίσεις μέχρι να γίνει."
    },
    {
      id: "d128-dig", level: "dig", difficulty: 1,
      title: "Διάλεξε συγκεκριμένες ώρες της μέρας για τα κοινωνικά δίκτυα",
      why: "Οι προγραμματισμένες επισκέψεις μετατρέπουν το ατελείωτο scroll σε δραστηριότητα με όρια."
    },
    {
      id: "d129-dig", level: "dig", difficulty: 1,
      title: "Πριν αναρτήσεις κάτι, ρώτα τον εαυτό σου γιατί το μοιράζεσαι",
      why: "Όταν αναρτάς με πρόθεση, μοιράζεσαι περισσότερα από όσα έχουν σημασία και λιγότερα για επιδοκιμασία."
    },
    {
      id: "d130-dig", level: "dig", difficulty: 2,
      title: "Διέγραψε ή αρχειοθέτησε παλιές αναρτήσεις με τις οποίες δεν ταυτίζεσαι πια",
      why: "Οι παλιές σου αναρτήσεις είναι ένα δημόσιο αρχείο του ποιος/α ήσουν. Κράτα μόνο όσα σε εκφράζουν."
    },
    {
      id: "d131-dig", level: "dig", difficulty: 2,
      title: "Εξέτασε τις ρυθμίσεις απορρήτου μιας πλατφόρμας κοινωνικής δικτύωσης",
      why: "Οι προεπιλεγμένες ρυθμίσεις συχνά μοιράζονται περισσότερα από όσα περιμένεις. Διάλεξε ποιος βλέπει τι."
    },
    {
      id: "d132-dig", level: "dig", difficulty: 1,
      title: "Αποχώρησε από ομάδες και κοινότητες στις οποίες δεν συμμετέχεις πια",
      why: "Οι ανενεργές συμμετοχές φέρνουν ακόμη ειδοποιήσεις και θόρυβο. Αποχώρησε με ήσυχη τη συνείδησή σου."
    },
    {
      id: "d133-dig", level: "dig", difficulty: 1,
      title: "Κρύψε τον αριθμό των likes όπου το επιτρέπει η πλατφόρμα",
      why: "Οι αριθμοί προκαλούν σύγκριση. Χωρίς αυτούς, μπορείς να απολαμβάνεις το περιεχόμενο για αυτό που είναι."
    },
    {
      id: "d134-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: τι έκανες με τον χρόνο που δεν πέρασες κάνοντας scroll;",
      why: "Ο χρόνος που κέρδισες πίσω είναι η πραγματική ανταμοιβή. Πρόσεξε πού πήγε."
    },
    {
      id: "d135-dig", level: "dig", difficulty: 2,
      title: "Διάλεξε μία-δύο αξιόπιστες πηγές ειδήσεων και έλεγχέ τες μία-δύο φορές τη μέρα",
      why: "Ο συνεχής έλεγχος ειδήσεων αυξάνει το άγχος χωρίς να σε ενημερώνει καλύτερα. Η ποιότητα νικά την ποσότητα."
    },
    {
      id: "d136-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τις ειδοποιήσεις έκτακτων ειδήσεων",
      why: "Ελάχιστες ειδήσεις απαιτούν αντίδραση μέσα σε λίγα λεπτά. Για ό,τι έχει σημασία θα μάθεις ούτως ή άλλως."
    },
    {
      id: "d137-dig", level: "dig", difficulty: 1,
      title: "Αντικατέστησε το scroll στις ειδήσεις με μία ημερήσια ή εβδομαδιαία σύνοψη",
      why: "Μια καλή σύνοψη δίνει πλαίσιο που δεν δίνουν οι ατελείωτοι τίτλοι."
    },
    {
      id: "d138-dig", level: "dig", difficulty: 2,
      title: "Πέρασε μια ολόκληρη μέρα χωρίς κοινωνικά δίκτυα",
      why: "Μία μέρα αρκεί για να νιώσεις την έλξη, και την ηρεμία που ακολουθεί."
    },
    {
      id: "d139-dig", level: "dig", difficulty: 3,
      title: "Κλείσε έναν λογαριασμό που δεν χρησιμοποιείς πια, αφού κατεβάσεις τα δεδομένα σου",
      why: "Οι αδρανείς λογαριασμοί κρατούν ακόμη τα δεδομένα σου και μπορεί να παραβιαστούν. Οι περισσότερες πλατφόρμες επιτρέπουν εξαγωγή δεδομένων πριν τη διαγραφή."
    },
    {
      id: "d140-dig", level: "dig", difficulty: 1,
      title: "Κάνε παύση ή καθάρισε το ιστορικό προβολών στις πλατφόρμες βίντεο για να επανέλθουν οι προτάσεις",
      why: "Οι προτάσεις αντανακλούν παλιές συνήθειες. Ένα reset σου δίνει ένα φρέσκο, πιο συνειδητό ξεκίνημα."
    },
    {
      id: "d141-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια πλατφόρμα σου λείπει λιγότερο;",
      why: "Αυτή που δεν σου λείπει είναι η πιο εύκολη να την αφήσεις εντελώς."
    },
    {
      id: "d142-dig", level: "dig", difficulty: 1,
      title: "Τηλεφώνησε σε έναν φίλο αντί να σχολιάσεις την ανάρτησή του",
      why: "Μια κουβέντα χτίζει σύνδεση με τρόπο που ένα σχόλιο δεν μπορεί."
    },
    {
      id: "d143-dig", level: "dig", difficulty: 1,
      title: "Ακολούθησε λίγους λογαριασμούς που σου μαθαίνουν κάτι χρήσιμο",
      why: "Τα κοινωνικά δίκτυα μπορούν να γίνουν βιβλιοθήκη αν το επιλέξεις. Αντικατέστησε τον θόρυβο με μάθηση."
    },
    {
      id: "d144-dig", level: "dig", difficulty: 1,
      title: "Σταμάτα να ακολουθείς λογαριασμούς που κυρίως σε κάνουν να θέλεις να αγοράσεις",
      why: "Το περιεχόμενο των influencers είναι συχνά μεταμφιεσμένη διαφήμιση. Λιγότερα ερεθίσματα, λιγότερες παρορμητικές αγορές."
    },
    {
      id: "d145-dig", level: "dig", difficulty: 3,
      title: "Κάνε ένα διάλειμμα επτά ημερών από μια πλατφόρμα κοινωνικής δικτύωσης",
      why: "Μια εβδομάδα μακριά δείχνει τι πραγματικά προσθέτει η πλατφόρμα στη ζωή σου, και τι κάνεις στη θέση της."
    },
    {
      id: "d146-dig", level: "dig", difficulty: 1,
      title: "Ενεργοποίησε τον έλεγχο ετικετών ώστε να εγκρίνεις τις φωτογραφίες πριν εμφανιστούν στο προφίλ σου",
      why: "Εσύ αποφασίζεις τι εμφανίζεται με το όνομά σου. Οι ρυθμίσεις ελέγχου θέλουν ένα λεπτό."
    },
    {
      id: "d147-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πώς ήταν η εβδομάδα σου μακριά από την πλατφόρμα;",
      why: "Πρόσεξε τη διάθεση, τη συγκέντρωση και τον ελεύθερο χρόνο σου. Αποφάσισε πώς θέλεις να επιστρέψεις, αν θέλεις."
    },
    {
      id: "d148-dig", level: "dig", difficulty: 1,
      title: "Γράψε ένα πράγμα που έκανες με τον χρόνο που κέρδισες αυτόν τον μήνα",
      why: "Ο χρόνος που επιστρέφει στο διάβασμα, στο περπάτημα ή στους ανθρώπους είναι το πραγματικό μέτρο επιτυχίας."
    },
    {
      id: "d149-dig", level: "dig", difficulty: 1,
      title: "Αποσυνδέσου από τα κοινωνικά δίκτυα στον υπολογιστή σου",
      why: "Όταν πρέπει να συνδέεσαι κάθε φορά, προστίθεται μια παύση και μια στιγμή να αποφασίσεις αν πραγματικά θέλεις να μπεις."
    },
    {
      id: "d150-dig", level: "dig", difficulty: 2,
      title: "Γράψε τους δικούς σου κανόνες για τα κοινωνικά δίκτυα: πότε, πού και για πόσο",
      why: "Οι προσωπικοί κανόνες, που αποφασίζονται με ηρεμία, λειτουργούν καλύτερα από τη θέληση της στιγμής."
    },
    {
      id: "d151-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Μαΐου: ποια αλλαγή στις ροές σου έκανε τη μεγαλύτερη διαφορά;",
      why: "Κράτα την αλλαγή που βοήθησε περισσότερο. Οι μικρές, διαρκείς αλλαγές νικούν τις δραματικές."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 152–181 · ΙΟΥΝΙΟΣ · Εκτός σύνδεσης & ταξίδια ===== */
    {
      id: "d152-dig", level: "dig", difficulty: 1,
      title: "Διάλεξε μια μέρα για «ψηφιακή αργία» και σημείωσέ τη στο ημερολόγιό σου",
      why: "Μια προγραμματισμένη μέρα εκτός σύνδεσης είναι πιο πιθανό να γίνει από μια αόριστη πρόθεση."
    },
    {
      id: "d153-dig", level: "dig", difficulty: 1,
      title: "Κατέβασε χάρτες εκτός σύνδεσης για το επόμενο ταξίδι σου",
      why: "Οι χάρτες εκτός σύνδεσης λειτουργούν χωρίς δεδομένα και σε γλιτώνουν από το συνεχές κοίταγμα του κινητού για σήμα."
    },
    {
      id: "d154-dig", level: "dig", difficulty: 2,
      title: "Κράτα ασφαλή ψηφιακά αντίγραφα των ταξιδιωτικών σου εγγράφων",
      why: "Αν χαθεί ένα διαβατήριο, ένα αντίγραφο επιταχύνει την αντικατάσταση. Φύλαξέ το σε κρυπτογραφημένο ή προστατευμένο με κωδικό σημείο."
    },
    {
      id: "d155-dig", level: "dig", difficulty: 1,
      title: "Ρύθμισε μια αυτόματη απάντηση απουσίας πριν τις διακοπές σου",
      why: "Οι σαφείς προσδοκίες σου επιτρέπουν να αποσυνδεθείς πραγματικά χωρίς ενοχές."
    },
    {
      id: "d156-dig", level: "dig", difficulty: 2,
      title: "Αφαίρεσε ή πάγωσε το email της δουλειάς στο κινητό σου στις διακοπές",
      why: "Διακοπές με το email της δουλειάς στην τσέπη είναι μισές διακοπές."
    },
    {
      id: "d157-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσο συχνά κοίταξες το κινητό σου χωρίς λόγο;",
      why: "Όταν προσέχεις τους έλεγχους χωρίς λόγο, κάνεις το πρώτο βήμα για να γίνουν λιγότεροι."
    },
    {
      id: "d158-dig", level: "dig", difficulty: 1,
      title: "Κατέβασε λίγα βιβλία ή podcasts συνειδητά, όχι δεκάδες",
      why: "Όταν διαλέγεις λίγα από πριν, γλιτώνεις το ατελείωτο ψάξιμο στον δρόμο."
    },
    {
      id: "d159-dig", level: "dig", difficulty: 1,
      title: "Πάρε ένα έντυπο βιβλίο στην παραλία ή στο πάρκο",
      why: "Ένα έντυπο βιβλίο δεν έχει ειδοποιήσεις. Προσκαλεί βαθύτερη, πιο ήρεμη προσοχή."
    },
    {
      id: "d160-dig", level: "dig", difficulty: 1,
      title: "Στην επόμενη έξοδό σου, τράβηξε λίγες φωτογραφίες και μετά άφησε το κινητό",
      why: "Όταν είσαι παρών/παρούσα, φτιάχνεις καλύτερες αναμνήσεις από το να καταγράφεις τα πάντα."
    },
    {
      id: "d161-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τα δεδομένα κινητής για εφαρμογές που δεν τα χρειάζονται",
      why: "Λιγότερες εφαρμογές με δεδομένα σημαίνουν λιγότερες ενημερώσεις στο παρασκήνιο, λιγότερη κατανάλωση μπαταρίας και λιγότερες διακοπές."
    },
    {
      id: "d162-dig", level: "dig", difficulty: 1,
      title: "Μοιράσου τις φωτογραφίες των διακοπών όταν επιστρέψεις, όχι σε πραγματικό χρόνο",
      why: "Όταν αναρτάς αργότερα, απολαμβάνεις τη στιγμή, και είναι πιο ασφαλές να μην ανακοινώνεις ότι το σπίτι σου είναι άδειο."
    },
    {
      id: "d163-dig", level: "dig", difficulty: 3,
      title: "Ψηφιακή αργία: πέρασε 24 ώρες εκτός σύνδεσης, ή όσο πιο κοντά σε αυτό μπορείς",
      why: "Επίτρεψε κλήσεις από την οικογένεια και τα απαραίτητα εργαλεία αν χρειάζεται. Πρόσεξε πώς η μέρα μεγαλώνει."
    },
    {
      id: "d164-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: τι παρατήρησες στην ψηφιακή αργία σου;",
      why: "Τα συναισθήματα, πρώτα ανησυχία και μετά ηρεμία, είναι χρήσιμη πληροφορία για τις συνήθειές σου."
    },
    {
      id: "d165-dig", level: "dig", difficulty: 1,
      title: "Αποφάσισε αν θέλεις να κάνεις την ψηφιακή αργία τακτική συνήθεια",
      why: "Μία φορά τον μήνα ή την εβδομάδα, μια τακτική μέρα εκτός σύνδεσης είναι ένα ισχυρό reset."
    },
    {
      id: "d166-dig", level: "dig", difficulty: 1,
      title: "Οργάνωσε ένα βράδυ χωρίς οθόνες με φίλους ή οικογένεια",
      why: "Ο κοινός χρόνος εκτός σύνδεσης είναι η καρδιά του ψηφιακού μινιμαλισμού: άνθρωποι πάνω από οθόνες."
    },
    {
      id: "d167-dig", level: "dig", difficulty: 1,
      title: "Περπάτησε σήμερα χωρίς ακουστικά και άκου το περιβάλλον σου",
      why: "Η συνεχής εισροή δεν αφήνει χώρο για τις δικές σου σκέψεις. Στη σιωπή εμφανίζονται οι ιδέες."
    },
    {
      id: "d168-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε ταξιδιωτικές εφαρμογές που χρησιμοποίησες μόνο για ένα ταξίδι",
      why: "Οι εφαρμογές κρατήσεων και μετακινήσεων μαζεύονται μετά τα ταξίδια. Μπορείς να τις ξαναεγκαταστήσεις την επόμενη φορά."
    },
    {
      id: "d169-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε ληγμένα εισιτήρια, κάρτες επιβίβασης και κάρτες από το ψηφιακό σου πορτοφόλι",
      why: "Μια καθαρή εφαρμογή πορτοφολιού δείχνει μόνο ό,τι ισχύει και είναι χρήσιμο."
    },
    {
      id: "d170-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια συνήθεια εκτός σύνδεσης θέλεις να κρατήσεις;",
      why: "Το καλοκαίρι είναι καλή εποχή να δοκιμάζεις νέες συνήθειες. Διάλεξε μία να την πάρεις μαζί σου στο φθινόπωρο."
    },
    {
      id: "d171-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε τη λειτουργία πτήσης για μία ώρα συγκεντρωμένης δουλειάς ή διαβάσματος",
      why: "Η λειτουργία πτήσης είναι το πιο απλό εργαλείο συγκέντρωσης που ήδη έχεις."
    },
    {
      id: "d172-dig", level: "dig", difficulty: 1,
      title: "Δες ένα ηλιοβασίλεμα χωρίς να το φωτογραφίσεις",
      why: "Κάποιες στιγμές υπάρχουν για να τις ζεις, όχι για να τις καταγράφεις."
    },
    {
      id: "d173-dig", level: "dig", difficulty: 1,
      title: "Γράψε με το χέρι μια κάρτα ή ένα γράμμα αντί να στείλεις μήνυμα",
      why: "Ένα χειρόγραφο σημείωμα θέλει περισσότερο χρόνο, και γι' αυτό ακριβώς το εκτιμούν."
    },
    {
      id: "d174-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε τα αποθηκευμένα μέρη και τις παλιές αναζητήσεις στην εφαρμογή χαρτών",
      why: "Τα αποθηκευμένα μέρη μαζεύονται με τα χρόνια. Κράτα όσα θα ξαναεπισκεφτείς."
    },
    {
      id: "d175-dig", level: "dig", difficulty: 2,
      title: "Αμέσως μετά από ένα ταξίδι, διάλεξε τις καλύτερες φωτογραφίες και διέγραψε τις υπόλοιπες",
      why: "Οι αποφάσεις είναι πιο εύκολες όσο οι αναμνήσεις είναι φρέσκες. Η αναμονή τις δυσκολεύει."
    },
    {
      id: "d176-dig", level: "dig", difficulty: 1,
      title: "Μοιράσου τις φωτογραφίες του ταξιδιού σε ένα κοινό άλμπουμ αντί για δεκάδες μηνύματα",
      why: "Ένα άλμπουμ το απολαμβάνουν όλοι πιο εύκολα και κρατά τις συνομιλίες ελαφριές."
    },
    {
      id: "d177-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: σύγκρινε τον χρόνο οθόνης σου με τον Ιανουάριο",
      why: "Έξι μήνες μικρών αλλαγών μπορεί να έχουν αλλάξει τις συνήθειές σου περισσότερο από όσο νομίζεις."
    },
    {
      id: "d178-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός εξαμήνου: ποια ψηφιακή αλλαγή σε βοήθησε περισσότερο;",
      why: "Όταν ξέρεις τι λειτούργησε, χτίζεις το δεύτερο μισό της χρονιάς σε γερές βάσεις."
    },
    {
      id: "d179-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε ξανά τις ειδοποιήσεις σου: ποιες νέες εφαρμογές τρύπωσαν;",
      why: "Οι νέες εφαρμογές ενεργοποιούν τις ειδοποιήσεις από προεπιλογή. Ένας τακτικός έλεγχος κρατά το κινητό σου ήσυχο."
    },
    {
      id: "d180-dig", level: "dig", difficulty: 2,
      title: "Δοκίμασε μια μέρα «μινιμαλιστικού κινητού»: μόνο κλήσεις, μηνύματα και χάρτες",
      why: "Όταν χρησιμοποιείς το κινητό μόνο ως εργαλείο για μία μέρα, βλέπεις πόσα από τα υπόλοιπα είναι προαιρετικά."
    },
    {
      id: "d181-dig", level: "dig", difficulty: 1,
      title: "Κάνε λίστα με τους πιο σημαντικούς λογαριασμούς σου: email, τράπεζα, cloud, κινητό",
      why: "Αυτός ο μήνας αφορά την ασφάλεια. Όταν ξέρεις ποιοι λογαριασμοί μετράνε περισσότερο, ξέρεις από πού να ξεκινήσεις."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 182–212 · ΙΟΥΛΙΟΣ · Ασφάλεια & ιδιωτικότητα ===== */
    {
      id: "d182-dig", level: "dig", difficulty: 3,
      title: "Εγκατάστησε έναν διαχειριστή κωδικών και πρόσθεσε τους πιο σημαντικούς λογαριασμούς σου",
      why: "Ένας διαχειριστής κωδικών θυμάται για σένα ισχυρούς, μοναδικούς κωδικούς. Είναι η μεγαλύτερη αναβάθμιση ασφάλειας που μπορούν να κάνουν οι περισσότεροι."
    },
    {
      id: "d183-dig", level: "dig", difficulty: 2,
      title: "Άλλαξε τους κωδικούς που επαναχρησιμοποιείς, ξεκινώντας από τον κύριο λογαριασμό email",
      why: "Το email σου μπορεί να επαναφέρει κάθε άλλο λογαριασμό, οπότε αξίζει τον πιο ισχυρό, μοναδικό κωδικό. Άφησε τον διαχειριστή κωδικών να τον δημιουργήσει."
    },
    {
      id: "d184-dig", level: "dig", difficulty: 2,
      title: "Ενεργοποίησε την ταυτοποίηση δύο παραγόντων στο email σου",
      why: "Ένα δεύτερο βήμα, όπως ένας κωδικός από εφαρμογή ή ένα κλειδί ασφαλείας, σταματά τις περισσότερες υποκλοπές λογαριασμών ακόμη κι αν διαρρεύσει ο κωδικός σου."
    },
    {
      id: "d185-dig", level: "dig", difficulty: 2,
      title: "Ενεργοποίησε την ταυτοποίηση δύο παραγόντων στην τράπεζα και στους άλλους βασικούς λογαριασμούς σου",
      why: "Προστάτεψε πρώτα τους λογαριασμούς που μετράνε περισσότερο. Μια εφαρμογή ταυτοποίησης είναι γενικά πιο ασφαλής από τους κωδικούς μέσω SMS."
    },
    {
      id: "d186-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε ένα passkey σε μια υπηρεσία που το υποστηρίζει",
      why: "Τα passkeys σου επιτρέπουν να συνδέεσαι με δακτυλικό αποτύπωμα, πρόσωπο ή το PIN της συσκευής, και δεν υποκλέπτονται με phishing όπως οι κωδικοί."
    },
    {
      id: "d187-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσοι λογαριασμοί βρίσκονται τώρα στον διαχειριστή κωδικών σου;",
      why: "Κάθε λογαριασμός που μεταφέρεις είναι ένας κωδικός λιγότερος να θυμάσαι και ένα αδύναμο σημείο λιγότερο."
    },
    {
      id: "d188-dig", level: "dig", difficulty: 1,
      title: "Έλεγξε αν το email σου εμφανίζεται σε γνωστές διαρροές δεδομένων και άλλαξε τους κωδικούς που επηρεάστηκαν",
      why: "Υπηρεσίες όπως το Have I Been Pwned δείχνουν αν η διεύθυνσή σου περιλαμβάνεται σε γνωστή διαρροή. Άλλαζε κωδικό όταν έχει εκτεθεί, όχι με σταθερό πρόγραμμα."
    },
    {
      id: "d189-dig", level: "dig", difficulty: 2,
      title: "Φύλαξε τους κωδικούς ανάκτησης σε ασφαλές σημείο εκτός σύνδεσης",
      why: "Αν χάσεις το κινητό σου, οι κωδικοί ανάκτησης είναι ο τρόπος να μπεις ξανά στους λογαριασμούς σου. Τύπωσέ τους ή φύλαξέ τους στον διαχειριστή κωδικών."
    },
    {
      id: "d190-dig", level: "dig", difficulty: 1,
      title: "Ενημέρωσε το τηλέφωνο και το email ανάκτησης στους κύριους λογαριασμούς σου",
      why: "Τα ξεπερασμένα στοιχεία ανάκτησης μπορεί να σε κλειδώσουν έξω για πάντα. Ο έλεγχος θέλει ένα λεπτό."
    },
    {
      id: "d191-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε ποιες εφαρμογές έχουν πρόσβαση στην κάμερα, στο μικρόφωνο και στις επαφές σου",
      why: "Πολλές εφαρμογές ζητούν περισσότερη πρόσβαση από όση χρειάζονται. Αφαίρεσε τις άδειες που δεν έχουν νόημα."
    },
    {
      id: "d192-dig", level: "dig", difficulty: 1,
      title: "Όρισε την πρόσβαση στην τοποθεσία σε «μόνο κατά τη χρήση» ή «ποτέ» για τις περισσότερες εφαρμογές",
      why: "Τα δεδομένα τοποθεσίας σχεδιάζουν έναν λεπτομερή χάρτη της ζωής σου. Λίγες εφαρμογές τα χρειάζονται στο παρασκήνιο."
    },
    {
      id: "d193-dig", level: "dig", difficulty: 2,
      title: "Αφαίρεσε εφαρμογές τρίτων που είναι συνδεδεμένες με τους κύριους λογαριασμούς σου σε Google, Apple ή κοινωνικά δίκτυα",
      why: "Οι συνδέσεις «Σύνδεση μέσω» μαζεύονται με τα χρόνια και μπορεί να έχουν ακόμη πρόσβαση στα δεδομένα σου."
    },
    {
      id: "d194-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποιο βήμα ασφαλείας σε καθησύχασε περισσότερο;",
      why: "Η ασφάλεια είναι ηρεμία. Πρόσεξε ποιο βήμα σού έδωσε την περισσότερη."
    },
    {
      id: "d195-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε ισχυρό κλείδωμα οθόνης και σύντομο χρόνο αυτόματου κλειδώματος",
      why: "Το κινητό σου περιέχει όλη σου τη ζωή. Ένα ισχυρό PIN ή βιομετρικά στοιχεία το προστατεύουν αν χαθεί."
    },
    {
      id: "d196-dig", level: "dig", difficulty: 1,
      title: "Ενεργοποίησε τον «Εντοπισμό συσκευής» και τη διαγραφή από απόσταση",
      why: "Αν χαθεί το κινητό ή ο υπολογιστής σου, μπορείς να τον εντοπίσεις ή να τον καθαρίσεις ώστε τα δεδομένα σου να μείνουν ασφαλή."
    },
    {
      id: "d197-dig", level: "dig", difficulty: 1,
      title: "Ενεργοποίησε τις αυτόματες ενημερώσεις ασφαλείας σε όλες τις συσκευές σου",
      why: "Οι περισσότερες επιθέσεις εκμεταλλεύονται γνωστά κενά που οι ενημερώσεις έχουν ήδη κλείσει. Οι αυτόματες ενημερώσεις τα κλείνουν χωρίς κόπο."
    },
    {
      id: "d198-dig", level: "dig", difficulty: 3,
      title: "Άλλαξε τον προεπιλεγμένο κωδικό διαχείρισης του router και ενημέρωσε το λογισμικό του",
      why: "Οι routers συχνά μένουν χρόνια με τις εργοστασιακές ρυθμίσεις. Προστατεύουν κάθε συσκευή του σπιτιού σου."
    },
    {
      id: "d199-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε παλιά αποθηκευμένα δίκτυα Wi-Fi από το κινητό και τον υπολογιστή σου",
      why: "Τα αποθηκευμένα δίκτυα μπορεί να κάνουν τις συσκευές να συνδέονται αυτόματα σε ψεύτικα σημεία με το ίδιο όνομα. Κράτα μόνο όσα χρησιμοποιείς."
    },
    {
      id: "d200-dig", level: "dig", difficulty: 2,
      title: "Ημέρα 200: αφαίρεσε τους αποθηκευμένους κωδικούς από τον browser αφού μεταφερθούν στον διαχειριστή",
      why: "Όταν οι κωδικοί βρίσκονται σε ένα αξιόπιστο σημείο, όλα είναι πιο απλά και πιο ασφαλή από πολλά αντίγραφα."
    },
    {
      id: "d201-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποιοι λογαριασμοί δεν έχουν ακόμη ταυτοποίηση δύο παραγόντων;",
      why: "Μια σύντομη λίστα με όσους απομένουν κάνει την ασφάλεια μια δουλειά που μπορεί να τελειώσει."
    },
    {
      id: "d202-dig", level: "dig", difficulty: 1,
      title: "Περιόρισε την εξατομίκευση διαφημίσεων στις ρυθμίσεις του κινητού και των λογαριασμών σου",
      why: "Λιγότερη παρακολούθηση σημαίνει λιγότερες στοχευμένες διαφημίσεις που σε ακολουθούν, και λιγότερες παρορμήσεις."
    },
    {
      id: "d203-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε τα cookies και τα δεδομένα ιστοτόπων που δεν επισκέπτεσαι πια",
      why: "Τα παλιά cookies κρατούν πληροφορίες παρακολούθησης για χρόνια. Ένα καθάρισμα σου δίνει έναν πιο ελαφρύ και πιο ιδιωτικό browser."
    },
    {
      id: "d204-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε παλιές συσκευές Bluetooth από τη λίστα συζευγμένων",
      why: "Οι παλιές συζεύξεις γεμίζουν τα μενού και μπορεί να προκαλούν μπερδέματα σύνδεσης. Κράτα μόνο όσες χρησιμοποιείς."
    },
    {
      id: "d205-dig", level: "dig", difficulty: 2,
      title: "Αφαίρεσε έξυπνες οικιακές συσκευές και εφαρμογές που δεν χρησιμοποιείς πια",
      why: "Οι αδρανείς συνδεδεμένες συσκευές μπορεί να συλλέγουν ακόμη δεδομένα και να μην παίρνουν πια ενημερώσεις ασφαλείας."
    },
    {
      id: "d206-dig", level: "dig", difficulty: 1,
      title: "Μάθε τα σημάδια του phishing και επιβεβαίωνε πριν πατήσεις σύνδεσμο",
      why: "Επείγων τόνος, απροσδόκητοι σύνδεσμοι, αιτήματα για κωδικούς ή πληρωμές: σταμάτα και έλεγξε μέσα από την επίσημη εφαρμογή ή ιστοσελίδα."
    },
    {
      id: "d207-dig", level: "dig", difficulty: 2,
      title: "Βάλε PIN στην κάρτα SIM σου",
      why: "Ένα PIN στη SIM δυσκολεύει κάποιον να χρησιμοποιήσει τον αριθμό σου αν κλαπεί το κινητό. Φύλαξε τον κωδικό PUK σε ασφαλές σημείο."
    },
    {
      id: "d208-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πώς νιώθεις που έχεις λιγότερους κωδικούς να θυμάσαι;",
      why: "Η σωστή ασφάλεια είναι πιο απλή, όχι πιο δύσκολη. Αυτός είναι ο μινιμαλισμός στην ασφάλεια."
    },
    {
      id: "d209-dig", level: "dig", difficulty: 1,
      title: "Μοιράσου κωδικούς με την οικογένεια μέσω του διαχειριστή κωδικών, όχι με μηνύματα",
      why: "Οι κωδικοί που στέλνονται σε συνομιλίες μένουν εκεί για πάντα. Η ασφαλής κοινή χρήση τους κρατά ιδιωτικούς."
    },
    {
      id: "d210-dig", level: "dig", difficulty: 2,
      title: "Ενεργοποίησε την κρυπτογράφηση δίσκου στον υπολογιστή σου",
      why: "Η ενσωματωμένη κρυπτογράφηση προστατεύει τα αρχεία σου αν χαθεί ή κλαπεί ο υπολογιστής. Φύλαξε το κλειδί ανάκτησης με ασφάλεια."
    },
    {
      id: "d211-dig", level: "dig", difficulty: 2,
      title: "Διέγραψε παλιά αντίγραφα ταυτοτήτων και ευαίσθητων εγγράφων που στάλθηκαν με email ή μηνύματα",
      why: "Τα αντίγραφα ταυτοτήτων σε παλιά μηνύματα είναι δώρο για όσους υποκλέπτουν ταυτότητες. Κράτα μόνο ένα ασφαλές αντίγραφο."
    },
    {
      id: "d212-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Ιουλίου: γράψε τα βήματα ασφαλείας που ολοκλήρωσες αυτόν τον μήνα",
      why: "Ένας μήνας δουλειάς στην ασφάλεια σε προστατεύει για χρόνια. Γράψε τι έγινε και τι απομένει."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 213–243 · ΑΥΓΟΥΣΤΟΣ · Προσοχή & συγκέντρωση ===== */
    {
      id: "d213-dig", level: "dig", difficulty: 1,
      title: "Διάβασε για 30 λεπτά χωρίς καμία διακοπή",
      why: "Το βαθύ διάβασμα είναι μια δεξιότητα που οι οθόνες φθείρουν. Τριάντα ήσυχα λεπτά αρχίζουν να την ξαναχτίζουν."
    },
    {
      id: "d214-dig", level: "dig", difficulty: 2,
      title: "Κάνε ένα πράγμα κάθε φορά για μία ολόκληρη ώρα",
      why: "Κάθε εναλλαγή ανάμεσα σε εργασίες κοστίζει συγκέντρωση. Όταν κάνεις ένα πράγμα τη φορά, είσαι πιο ήρεμος/η και συχνά πιο γρήγορος/η."
    },
    {
      id: "d215-dig", level: "dig", difficulty: 1,
      title: "Άφησε τον εαυτό σου να βαρεθεί για δέκα λεπτά χωρίς να πιάσεις το κινητό",
      why: "Στη βαρεμάρα το μυαλό ξεκουράζεται και γεννιούνται νέες ιδέες. Η αναμονή σε μια ουρά είναι καλή ευκαιρία για εξάσκηση."
    },
    {
      id: "d216-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πότε ένιωσες πιο συγκεντρωμένος/η αυτή την εβδομάδα;",
      why: "Όταν ξέρεις τις συνθήκες που σε βοηθούν να συγκεντρώνεσαι, μπορείς να τις δημιουργείς σκόπιμα."
    },
    {
      id: "d217-dig", level: "dig", difficulty: 1,
      title: "Διάβασε ένα μεγάλο άρθρο αντί για δεκάδες τίτλους",
      why: "Οι τίτλοι προκαλούν αντιδράσεις· τα μεγάλα κείμενα χαρίζουν κατανόηση."
    },
    {
      id: "d218-dig", level: "dig", difficulty: 1,
      title: "Διάλεξε ένα χόμπι χωρίς οθόνη για να του αφιερώσεις χρόνο αυτόν τον μήνα",
      why: "Ζωγραφική, μουσική, κηπουρική, παζλ: οι δραστηριότητες με τα χέρια αποκαθιστούν την προσοχή με τρόπους που οι οθόνες δεν μπορούν."
    },
    {
      id: "d219-dig", level: "dig", difficulty: 1,
      title: "Γράψε σε ένα χάρτινο ημερολόγιο για δέκα λεπτά",
      why: "Η γραφή με το χέρι επιβραδύνει τη σκέψη αρκετά ώστε να την ακούς καθαρά."
    },
    {
      id: "d220-dig", level: "dig", difficulty: 1,
      title: "Δες μια ταινία από την αρχή ως το τέλος χωρίς δεύτερη οθόνη",
      why: "Η μοιρασμένη προσοχή χαλάει και τις δύο εμπειρίες. Δώσε στην ιστορία όλη σου την προσοχή."
    },
    {
      id: "d221-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια δραστηριότητα χωρίς οθόνη απόλαυσες περισσότερο;",
      why: "Οι απολαύσεις εκτός σύνδεσης ξεχνιούνται εύκολα. Πρόσεξε ποιες αξίζει να τους κάνεις χώρο."
    },
    {
      id: "d222-dig", level: "dig", difficulty: 3,
      title: "Προγραμμάτισε 90 λεπτά βαθιάς δουλειάς με όλες τις ειδοποιήσεις κλειστές",
      why: "Στα μεγάλα, αδιάκοπα διαστήματα γίνεται η ουσιαστική δουλειά. Προστάτεψε ένα όπως θα προστάτευες μια σημαντική συνάντηση."
    },
    {
      id: "d223-dig", level: "dig", difficulty: 1,
      title: "Αντικατέστησε μια ψηφιακή συνήθεια με μια φυσική, όπως ένα χάρτινο σημειωματάριο",
      why: "Τα φυσικά εργαλεία έχουν φυσικά όρια και καμία ειδοποίηση. Σε κρατούν στη δουλειά που κάνεις."
    },
    {
      id: "d224-dig", level: "dig", difficulty: 1,
      title: "Άκου έναν ολόκληρο δίσκο από την αρχή ως το τέλος, χωρίς να κάνεις τίποτα άλλο",
      why: "Η μουσική γίνεται φόντο όταν κάνουμε πολλά μαζί. Όταν ακούς με προσοχή, ξαναγίνεται εμπειρία."
    },
    {
      id: "d225-dig", level: "dig", difficulty: 1,
      title: "Πέρασε χρόνο στη φύση χωρίς καμία συσκευή",
      why: "Η φύση αποκαθιστά την προσοχή με φυσικό τρόπο. Άφησε το κινητό στην τσάντα ή στο σπίτι."
    },
    {
      id: "d226-dig", level: "dig", difficulty: 1,
      title: "Δοκίμασε πέντε λεπτά ήρεμης αναπνοής χωρίς εφαρμογή",
      why: "Δεν χρειάζεσαι συνδρομή για να κάτσεις ακίνητος/η. Απλώς ανάπνεε και παρατήρησε."
    },
    {
      id: "d227-dig", level: "dig", difficulty: 1,
      title: "Κάνε σήμερα μια κουβέντα χωρίς κινητό σε κοινή θέα",
      why: "Ακόμη κι ένα ορατό κινητό μειώνει το βάθος μιας κουβέντας. Βάλ' το μακριά και άκου."
    },
    {
      id: "d228-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόση ώρα μπορείς πλέον να διαβάζεις πριν πιάσεις το κινητό;",
      why: "Η προσοχή δυναμώνει με την εξάσκηση. Πρόσεξε κάθε βελτίωση, όσο μικρή κι αν είναι."
    },
    {
      id: "d229-dig", level: "dig", difficulty: 1,
      title: "Πρόσεξε πόσο συχνά νιώθεις «φανταστικές» δονήσεις ή ελέγχεις το κινητό χωρίς λόγο",
      why: "Αυτά τα αντανακλαστικά δείχνουν πόσο βαθιά μας έχει εκπαιδεύσει το κινητό. Όταν τα προσέχεις, αδυνατίζουν."
    },
    {
      id: "d230-dig", level: "dig", difficulty: 1,
      title: "Επισκέψου μια βιβλιοθήκη ή ένα βιβλιοπωλείο και περιηγήσου με την ησυχία σου",
      why: "Η περιήγηση ανάμεσα σε αληθινά ράφια οδηγεί σε απρόσμενες ανακαλύψεις που δεν προσφέρουν οι αλγόριθμοι."
    },
    {
      id: "d231-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε μια χάρτινη λίστα εργασιών για μια ολόκληρη μέρα",
      why: "Μια χάρτινη λίστα δεν μπορεί να σου αποσπάσει την προσοχή. Και το να διαγράφεις ό,τι έγινε είναι ικανοποιητικό."
    },
    {
      id: "d232-dig", level: "dig", difficulty: 1,
      title: "Παίξε ένα επιτραπέζιο ή χαρτιά με άλλους",
      why: "Τα παιχνίδια γύρω από ένα τραπέζι φέρνουν τους ανθρώπους κοντά με τρόπο που σπάνια καταφέρνουν οι οθόνες."
    },
    {
      id: "d233-dig", level: "dig", difficulty: 2,
      title: "Πέρασε ένα πρωινό Σαββατοκύριακου εντελώς χωρίς οθόνες",
      why: "Ένα αργό πρωινό χωρίς οθόνες δίνει πιο ήρεμο τόνο σε όλο το Σαββατοκύριακο."
    },
    {
      id: "d234-dig", level: "dig", difficulty: 1,
      title: "Αφιέρωσε μία ώρα για να μάθεις μια πρακτική δεξιότητα εκτός σύνδεσης",
      why: "Μαγείρεμα, επισκευές, ράψιμο ή σκίτσο: η μάθηση με τα χέρια χτίζει διαρκή ικανοποίηση."
    },
    {
      id: "d235-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: τι έμαθες ή δημιούργησες αυτή την εβδομάδα;",
      why: "Η δημιουργία έχει άλλη αίσθηση από την κατανάλωση. Πρόσεξε την ισορροπία ανάμεσα στα δύο."
    },
    {
      id: "d236-dig", level: "dig", difficulty: 1,
      title: "Στην επόμενη συναυλία ή εκδήλωση, τράβηξε το πολύ ένα σύντομο βίντεο",
      why: "Όταν βλέπεις μέσα από μια οθόνη, μπαίνει απόσταση ανάμεσα σε σένα και τη στιγμή."
    },
    {
      id: "d237-dig", level: "dig", difficulty: 1,
      title: "Δοκίμασε τον κανόνα του «ενός επεισοδίου» για τις σειρές αυτή την εβδομάδα",
      why: "Όταν επιλέγεις εσύ πότε να σταματήσεις, αντί να αποφασίζει το επόμενο επεισόδιο, τα βράδια μένουν δικά σου."
    },
    {
      id: "d238-dig", level: "dig", difficulty: 1,
      title: "Κάτσε έξω το βράδυ και απλώς κοίτα τον ουρανό",
      why: "Οι καλοκαιρινές νύχτες προσκαλούν σε αργούς ρυθμούς. Δέκα λεπτά με το βλέμμα ψηλά είναι ένα απλό reset."
    },
    {
      id: "d239-dig", level: "dig", difficulty: 1,
      title: "Επισκέψου έναν φίλο από κοντά αντί να συνομιλείτε online",
      why: "Ο χρόνος μαζί από κοντά δημιουργεί σύνδεση που τα μηνύματα δεν μπορούν να αντικαταστήσουν."
    },
    {
      id: "d240-dig", level: "dig", difficulty: 1,
      title: "Ονόμασε τη δραστηριότητα εκτός σύνδεσης που σε ανανέωσε περισσότερο αυτό το καλοκαίρι",
      why: "Αυτή είναι η δραστηριότητα που αξίζει να προστατεύσεις τις πιο πολυάσχολες εποχές."
    },
    {
      id: "d241-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: κρατάνε οι συνήθειές σου με τις οθόνες μετά το καλοκαίρι;",
      why: "Η επιστροφή στη ρουτίνα είναι η στιγμή που επιστρέφουν οι παλιές συνήθειες. Μείνε σε εγρήγορση."
    },
    {
      id: "d242-dig", level: "dig", difficulty: 1,
      title: "Σχεδίασε μερικές δραστηριότητες εκτός σύνδεσης για το φθινόπωρο",
      why: "Οι προγραμματισμένες δραστηριότητες είναι πιο πιθανό να γίνουν και πιο εύκολο να προτιμηθούν από τις οθόνες."
    },
    {
      id: "d243-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Αυγούστου: τι σου έμαθε ένας μήνας συγκέντρωσης και χρόνου εκτός σύνδεσης;",
      why: "Η προσοχή είναι πόρος. Πρόσεξε σε τι θέλεις να συνεχίσεις να την ξοδεύεις."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 244–273 · ΣΕΠΤΕΜΒΡΙΟΣ · Οργάνωση ===== */
    {
      id: "d244-dig", level: "dig", difficulty: 3,
      title: "Διάλεξε ένα εργαλείο εργασιών και μετέφερε εκεί όλες τις εκκρεμότητές σου",
      why: "Οι εκκρεμότητες σκορπισμένες σε σημειώσεις, email και χαρτάκια ξεχνιούνται εύκολα. Μία αξιόπιστη λίστα ελευθερώνει το μυαλό σου."
    },
    {
      id: "d245-dig", level: "dig", difficulty: 2,
      title: "Γράψε κάθε εκκρεμότητα που έχεις στο μυαλό σου",
      why: "Οι ανολοκλήρωτες δουλειές γυρίζουν συνέχεια στο κεφάλι σου. Όταν τις γράφεις όλες, το μυαλό σου ξεκουράζεται."
    },
    {
      id: "d246-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε παλιά επαναλαμβανόμενα γεγονότα και ξεπερασμένες καταχωρίσεις από το ημερολόγιό σου",
      why: "Ένα ημερολόγιο γεμάτο παλιά γεγονότα κρύβει αυτά που έχουν σημασία."
    },
    {
      id: "d247-dig", level: "dig", difficulty: 2,
      title: "Όρισε μια εβδομαδιαία ανασκόπηση 30 λεπτών για εκκρεμότητες και ημερολόγιο",
      why: "Μια εβδομαδιαία ματιά πίσω και μπροστά κρατά τα πάντα υπό έλεγχο χωρίς καθημερινό άγχος."
    },
    {
      id: "d248-dig", level: "dig", difficulty: 1,
      title: "Σχεδίασε την αυριανή μέρα σε χρονικά μπλοκ πριν τελειώσεις τη σημερινή",
      why: "Όταν ξέρεις με τι ξεκινάς αύριο, το ξεκίνημα γίνεται πιο εύκολο και το κλείσιμο της μέρας πιο ήρεμο."
    },
    {
      id: "d249-dig", level: "dig", difficulty: 1,
      title: "Όρισε τις ώρες εργασίας ή την κατάστασή σου στις εφαρμογές συνομιλίας της δουλειάς",
      why: "Η σαφής διαθεσιμότητα βοηθά τους συναδέλφους να ξέρουν πότε να περιμένουν απάντηση και προστατεύει τα βράδια σου."
    },
    {
      id: "d250-dig", level: "dig", difficulty: 1,
      title: "Σίγασε τις ειδοποιήσεις της δουλειάς εκτός ωραρίου",
      why: "Η ξεκούραση χρειάζεται όρια. Η δουλειά θα είναι εκεί και αύριο το πρωί."
    },
    {
      id: "d251-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: η λίστα εργασιών σε βοήθησε ή σε πίεσε αυτή την εβδομάδα;",
      why: "Ένα καλό σύστημα μειώνει το άγχος. Αν το δικό σου δεν το κάνει, απλοποίησέ το."
    },
    {
      id: "d252-dig", level: "dig", difficulty: 2,
      title: "Κλείσε στο ημερολόγιό σου ένα διάστημα συγκέντρωσης χωρίς συναντήσεις κάθε εβδομάδα",
      why: "Ο απροστάτευτος χρόνος γεμίζει από άλλους. Ένα επαναλαμβανόμενο μπλοκ κρατά χώρο για πραγματική δουλειά."
    },
    {
      id: "d253-dig", level: "dig", difficulty: 2,
      title: "Μείωσε τα κανάλια από τα οποία σε προσεγγίζουν",
      why: "Email, τρεις εφαρμογές συνομιλίας και SMS σημαίνουν πέντε σημεία για έλεγχο. Συμφωνήστε σε λιγότερα."
    },
    {
      id: "d254-dig", level: "dig", difficulty: 1,
      title: "Αρχειοθέτησε παλιούς φακέλους σε κοινόχρηστους χώρους αποθήκευσης",
      why: "Οι κοινόχρηστοι χώροι γεμίζουν με ολοκληρωμένα έργα. Η αρχειοθέτηση βοηθά όλους να βρίσκουν την τρέχουσα δουλειά."
    },
    {
      id: "d255-dig", level: "dig", difficulty: 1,
      title: "Μάθε τρεις συντομεύσεις πληκτρολογίου που θα χρησιμοποιείς καθημερινά",
      why: "Οι μικρές τριβές αθροίζονται. Οι συντομεύσεις γλιτώνουν δευτερόλεπτα που γίνονται ώρες μέσα σε έναν χρόνο."
    },
    {
      id: "d256-dig", level: "dig", difficulty: 1,
      title: "Δούλεψε με ένα παράθυρο browser και λίγες καρτέλες",
      why: "Λιγότερες καρτέλες σημαίνουν λιγότερους πειρασμούς και πιο γρήγορο υπολογιστή."
    },
    {
      id: "d257-dig", level: "dig", difficulty: 1,
      title: "Πέρασε τη λίστα «για διάβασμα αργότερα»: διάβασέ τα τώρα ή διέγραψέ τα",
      why: "Τα αποθηκευμένα άρθρα μαζεύονται αδιάβαστα. Αν δεν αξίζει να διαβαστεί τώρα, ίσως δεν διαβαστεί ποτέ."
    },
    {
      id: "d258-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσες καρτέλες είναι ανοιχτές αυτή τη στιγμή;",
      why: "Ο αριθμός των ανοιχτών καρτελών είναι καλό μέτρο της νοητικής ακαταστασίας."
    },
    {
      id: "d259-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε αχρησιμοποίητες εφαρμογές από τη γραμμή εργασιών του υπολογιστή",
      why: "Κράτα σε απόσταση ενός κλικ μόνο τα εργαλεία που ανοίγεις καθημερινά."
    },
    {
      id: "d260-dig", level: "dig", difficulty: 1,
      title: "Διάλεξε μία προεπιλεγμένη εφαρμογή για κάθε δουλειά: σημειώσεις, ημερολόγιο, μουσική",
      why: "Δύο εφαρμογές για την ίδια δουλειά σημαίνουν διπλές αποφάσεις και σκόρπια πληροφορία."
    },
    {
      id: "d261-dig", level: "dig", difficulty: 2,
      title: "Αυτοματοποίησε μια επαναλαμβανόμενη εργασία, όπως την πληρωμή ενός τακτικού λογαριασμού",
      why: "Η αυτοματοποίηση αφαιρεί μικρές αποφάσεις και ξεχασμένες προθεσμίες. Έλεγχέ την πού και πού για να έχεις τον έλεγχο."
    },
    {
      id: "d262-dig", level: "dig", difficulty: 2,
      title: "Πρόσθεσε τους υπόλοιπους λογαριασμούς σου στον διαχειριστή κωδικών",
      why: "Όταν ολοκληρώσεις τη μεταφορά, δεν θα χρειαστεί ποτέ ξανά να θυμάσαι ή να επαναχρησιμοποιείς κωδικό."
    },
    {
      id: "d263-dig", level: "dig", difficulty: 1,
      title: "Κράτα όλες τις σημειώσεις σου σε μία εφαρμογή",
      why: "Οι σημειώσεις σκορπισμένες σε πολλές εφαρμογές δύσκολα βρίσκονται. Ένα σημείο τις κάνει πραγματικό εργαλείο."
    },
    {
      id: "d264-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: κάνε την εβδομαδιαία ανασκόπησή σου",
      why: "Η συνέπεια κάνει την ανασκόπηση γρήγορη. Είναι η συνήθεια που κρατά ενωμένο όλο το σύστημα."
    },
    {
      id: "d265-dig", level: "dig", difficulty: 1,
      title: "Φτιάξε ένα τελετουργικό κλεισίματος της μέρας: κλείσε εφαρμογές, δες το αύριο, αποσυνδέσου",
      why: "Ένα σαφές τέλος επιτρέπει στο μυαλό σου να αφήσει πίσω τη δουλειά."
    },
    {
      id: "d266-dig", level: "dig", difficulty: 2,
      title: "Φέρε το inbox σου στο μηδέν μία φορά, απλώς για να δεις πώς είναι",
      why: "Το άδειο inbox δεν είναι καθημερινός κανόνας, αλλά όταν το φτάσεις μία φορά, βλέπεις ότι γίνεται και νιώθεις ελαφριά."
    },
    {
      id: "d267-dig", level: "dig", difficulty: 1,
      title: "Πες όχι σε μια ψηφιακή δέσμευση: μια ομάδα, ένα webinar ή ένα newsletter",
      why: "Κάθε ναι σε κάτι λιγότερο σημαντικό είναι ένα όχι σε κάτι που μετράει περισσότερο."
    },
    {
      id: "d268-dig", level: "dig", difficulty: 1,
      title: "Κάνε διαγραφή από email υπενθυμίσεων για εκδηλώσεις και webinars",
      why: "Οι προσκλήσεις σε όσα δεν θα παρακολουθήσεις ποτέ γεμίζουν το inbox σου. Κάνε διαγραφή από τους διοργανωτές."
    },
    {
      id: "d269-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε συνδρομές ημερολογίου που δεν χρειάζεσαι πια",
      why: "Ημερολόγια αργιών, αγώνων και παλιά κοινόχρηστα ημερολόγια προσθέτουν ακαταστασία σε κάθε προβολή."
    },
    {
      id: "d270-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια αλλαγή στην οργάνωση σου γλίτωσε τον περισσότερο χρόνο;",
      why: "Κράτα τα εργαλεία και τις συνήθειες που αποδίδουν περισσότερα από όσα κοστίζουν."
    },
    {
      id: "d271-dig", level: "dig", difficulty: 1,
      title: "Σίγασε ή αποχώρησε από κανάλια συνομιλίας της δουλειάς που δεν χρειάζεται να παρακολουθείς",
      why: "Τα κανάλια πολλαπλασιάζονται γρήγορα. Μείνε σε όσα συνεισφέρεις ή χρειάζεσαι την πληροφορία."
    },
    {
      id: "d272-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Σεπτεμβρίου: ποιο σύστημα κρατάς;",
      why: "Ένα απλό σύστημα που χρησιμοποιείς νικά ένα τέλειο που εγκαταλείπεις."
    },
    {
      id: "d273-dig", level: "dig", difficulty: 2,
      title: "Κάνε λίστα με όλες τις συνδρομές σου ελέγχοντας τις κινήσεις του λογαριασμού και της κάρτας",
      why: "Οι συνδρομές κρύβονται σε μικρές μηνιαίες χρεώσεις. Οι κινήσεις αποκαλύπτουν την πλήρη εικόνα."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 274–304 · ΟΚΤΩΒΡΙΟΣ · Λογαριασμοί & συνδρομές ===== */
    {
      id: "d274-dig", level: "dig", difficulty: 3,
      title: "Ακύρωσε κάθε συνδρομή που δεν χρησιμοποίησες τις τελευταίες 30 ημέρες",
      why: "Οι μικρές μηνιαίες χρεώσεις αθροίζονται αθόρυβα. Μπορείς πάντα να εγγραφείς ξανά αν κάτι σου λείψει πραγματικά."
    },
    {
      id: "d275-dig", level: "dig", difficulty: 1,
      title: "Βάλε υπενθύμιση πριν λήξει κάθε δωρεάν δοκιμή ή μην την ξεκινήσεις",
      why: "Οι δωρεάν δοκιμές σχεδιάζονται ώστε να γίνονται πληρωμένες συνδρομές που ξεχνάς."
    },
    {
      id: "d276-dig", level: "dig", difficulty: 2,
      title: "Εναλλάσσε τις υπηρεσίες streaming αντί να πληρώνεις πολλές ταυτόχρονα",
      why: "Γράψου σε μία, δες ό,τι θέλεις, ακύρωσε και προχώρα στην επόμενη. Ίδιο περιεχόμενο, μικρότερο κόστος."
    },
    {
      id: "d277-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσα θα σου γλιτώσουν τον χρόνο οι ακυρώσεις αυτού του μήνα;",
      why: "Πολλαπλασίασε τη μηνιαία εξοικονόμηση επί δώδεκα. Ο αριθμός συνήθως δίνει κίνητρο."
    },
    {
      id: "d278-dig", level: "dig", difficulty: 2,
      title: "Αναζήτησε στο email σου «καλώς ήρθες» και «επιβεβαίωση λογαριασμού» για να βρεις ξεχασμένους λογαριασμούς",
      why: "Κάθε εγγραφή άφησε ένα ίχνος στο inbox σου. Είναι ο πιο εύκολος τρόπος να χαρτογραφήσεις το ψηφιακό σου αποτύπωμα."
    },
    {
      id: "d279-dig", level: "dig", difficulty: 3,
      title: "Διέγραψε τρεις παλιούς λογαριασμούς που δεν χρησιμοποιείς πια",
      why: "Κάθε ξεχασμένος λογαριασμός κρατά προσωπικά δεδομένα που μπορεί να διαρρεύσουν. Λιγότεροι λογαριασμοί, μικρότερος κίνδυνος."
    },
    {
      id: "d280-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε παλιούς λογαριασμούς σε φόρουμ, παιχνίδια και εφαρμογές από παλιά χρόνια",
      why: "Τα παλιά ονόματα χρήστη και προφίλ ζουν πολύ αφού έχεις προχωρήσει. Κλείσε ό,τι μπορείς."
    },
    {
      id: "d281-dig", level: "dig", difficulty: 2,
      title: "Αναζήτησε το όνομά σου online και ζήτα να αφαιρεθούν ξεπερασμένες πληροφορίες",
      why: "Τα παλιά προφίλ και οι σελίδες μπορεί να εμφανίζονται για χρόνια. Πολλοί ιστότοποι προσφέρουν διαδικασία αφαίρεσης ή διόρθωσης."
    },
    {
      id: "d282-dig", level: "dig", difficulty: 2,
      title: "Ζήτα από μια εταιρεία που σου στέλνει διαφημίσεις να διαγράψει τα δεδομένα σου",
      why: "Στην ΕΕ, ο GDPR σου δίνει σε πολλές περιπτώσεις το δικαίωμα να ζητήσεις διαγραφή των προσωπικών σου δεδομένων. Ένα σύντομο email συχνά αρκεί."
    },
    {
      id: "d283-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσους λογαριασμούς έχεις κλείσει μέχρι τώρα;",
      why: "Κάθε λογαριασμός που κλείνει είναι ένα πράγμα λιγότερο για ασφάλιση, ενημέρωση και ανησυχία."
    },
    {
      id: "d284-dig", level: "dig", difficulty: 1,
      title: "Κράτα μόνο τις εφαρμογές επιβράβευσης που πραγματικά χρησιμοποιείς",
      why: "Οι εφαρμογές επιβράβευσης συλλέγουν δεδομένα και στέλνουν προσφορές. Κράτα μία-δύο που δίνουν πραγματική αξία."
    },
    {
      id: "d285-dig", level: "dig", difficulty: 1,
      title: "Ακύρωσε πληρωμένα πακέτα αποθήκευσης cloud που δεν χρησιμοποιείς",
      why: "Αφού συγκεντρώσεις τα αρχεία σου, τα επιπλέον πακέτα αποθήκευσης είναι χρήματα για το τίποτα."
    },
    {
      id: "d286-dig", level: "dig", difficulty: 1,
      title: "Αποχωρίσου αχρησιμοποίητα domain names, ιστοσελίδες ή πακέτα φιλοξενίας",
      why: "Οι προσωπικές ιδέες που δεν ξεκίνησαν ποτέ συχνά συνεχίζουν να χρεώνουν κάθε χρόνο."
    },
    {
      id: "d287-dig", level: "dig", difficulty: 1,
      title: "Χρησιμοποίησε οικογενειακά πακέτα αντί να πληρώνετε ξεχωριστούς λογαριασμούς",
      why: "Πολλές υπηρεσίες προσφέρουν οικογενειακή κοινή χρήση. Ένα πακέτο για όλο το σπίτι είναι πιο απλό και πιο φθηνό."
    },
    {
      id: "d288-dig", level: "dig", difficulty: 1,
      title: "Έλεγξε τη λίστα συνδρομών στο κατάστημα εφαρμογών του κινητού σου",
      why: "Οι συνδρομές σε εφαρμογές ξεχνιούνται εύκολα επειδή χρεώνονται μέσω του καταστήματος. Έλεγξέ τες εκεί."
    },
    {
      id: "d289-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε παλιές συσκευές που είναι καταχωρισμένες στους λογαριασμούς σου",
      why: "Παλιά κινητά και tablet μπορεί να εμφανίζονται ακόμη με πρόσβαση. Όταν τα αφαιρείς, οι λογαριασμοί σου μένουν τακτοποιημένοι και ασφαλείς."
    },
    {
      id: "d290-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσο ελαφρύ νιώθεις τώρα το ψηφιακό σου αποτύπωμα;",
      why: "Λιγότεροι λογαριασμοί και συνδρομές σημαίνουν λιγότερους λογαριασμούς πληρωμής, κωδικούς και ανησυχίες."
    },
    {
      id: "d291-dig", level: "dig", difficulty: 1,
      title: "Ενημέρωσε λογαριασμούς που είναι ακόμη συνδεδεμένοι με παλιό αριθμό τηλεφώνου",
      why: "Ένας παλιός αριθμός μπορεί να δοθεί σε κάποιον άλλον, ο οποίος θα λαμβάνει τους κωδικούς σου."
    },
    {
      id: "d292-dig", level: "dig", difficulty: 1,
      title: "Βεβαιώσου ότι οι κωδικοί για κρατικές και φορολογικές πλατφόρμες είναι στον διαχειριστή κωδικών",
      why: "Αυτοί είναι οι λογαριασμοί που χρειάζεσαι στις πιο άβολες στιγμές. Κράτα τους έτοιμους."
    },
    {
      id: "d293-dig", level: "dig", difficulty: 2,
      title: "Γράψε μια σύντομη λίστα με τους βασικούς λογαριασμούς σου για περίπτωση ανάγκης",
      why: "Σε μια έκτακτη ανάγκη, κάποιος που εμπιστεύεσαι μπορεί να χρειαστεί να ξέρει ποιοι λογαριασμοί υπάρχουν. Η λίστα δεν χρειάζεται κωδικούς."
    },
    {
      id: "d294-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε λογαριασμούς σε εφαρμογές μηνυμάτων που δεν χρησιμοποιείς πια",
      why: "Οι αδρανείς λογαριασμοί μηνυμάτων σε δείχνουν ακόμη διαθέσιμο/η. Κλείσ' τους για να απλοποιήσεις την επικοινωνία."
    },
    {
      id: "d295-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε παλιά email ειδοποιήσεων από υπηρεσίες που έκλεισες",
      why: "Από τη στιγμή που ένας λογαριασμός κλείνει, τα email του είναι απλώς ακαταστασία."
    },
    {
      id: "d296-dig", level: "dig", difficulty: 1,
      title: "Κάνε ένα δεύτερο ξεκαθάρισμα στα newsletters: διαγραφή από ό,τι νέο αγνοείς",
      why: "Οι νέες συνδρομές τρυπώνουν μέσα στους μήνες. Ένα γρήγορο ξεκαθάρισμα κρατά το inbox σου ήρεμο."
    },
    {
      id: "d297-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποιος λογαριασμός ή ποια συνδρομή ήταν η πιο δύσκολη στην ακύρωση;",
      why: "Οι υπηρεσίες που δυσκολεύουν την αποχώρηση αξίζουν περισσότερη προσοχή την επόμενη φορά που θα εγγραφείς."
    },
    {
      id: "d298-dig", level: "dig", difficulty: 1,
      title: "Άθροισε τα συνολικά μηνιαία σου έξοδα για ψηφιακές υπηρεσίες",
      why: "Όταν βλέπεις τον συνολικό αριθμό, αποφασίζεις πιο εύκολα τι αξίζει πραγματικά να πληρώνεις."
    },
    {
      id: "d299-dig", level: "dig", difficulty: 1,
      title: "Βάλε στο ημερολόγιό σου μια ετήσια ημερομηνία ελέγχου συνδρομών",
      why: "Ένας προγραμματισμένος έλεγχος τον χρόνο εμποδίζει τις συνδρομές να επιστρέψουν σιγά σιγά."
    },
    {
      id: "d300-dig", level: "dig", difficulty: 1,
      title: "Ημέρα 300: σύγκρινε πόσες εφαρμογές έχεις τώρα με την αρχή της χρονιάς",
      why: "Τριακόσιες μέρες μικρών επιλογών διαμορφώνουν μια πιο ελαφριά ψηφιακή ζωή. Δες τη διαφορά."
    },
    {
      id: "d301-dig", level: "dig", difficulty: 1,
      title: "Απεγκατάστησε πλατφόρμες παιχνιδιών και βιβλιοθήκες που δεν χρησιμοποιείς πια",
      why: "Οι πλατφόρμες παιχνιδιών συχνά ξεκινούν αυτόματα και ενημερώνουν μεγάλα αρχεία στο παρασκήνιο."
    },
    {
      id: "d302-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε αχρησιμοποίητες εφαρμογές και λογαριασμούς από την έξυπνη τηλεόρασή σου",
      why: "Οι εφαρμογές της τηλεόρασης μαζεύονται και ορισμένες καταγράφουν τις συνήθειες προβολής. Κράτα όσες βλέπεις."
    },
    {
      id: "d303-dig", level: "dig", difficulty: 2,
      title: "Έλεγξε ποιες συσκευές είναι συνδεδεμένες στους κύριους λογαριασμούς σου και αποσύνδεσε τις άγνωστες",
      why: "Οι περισσότερες υπηρεσίες δείχνουν τις ενεργές συνδέσεις. Αξίζει να αφαιρέσεις και να ερευνήσεις τις άγνωστες συσκευές."
    },
    {
      id: "d304-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Οκτωβρίου: πόσους λογαριασμούς και συνδρομές αφαίρεσες;",
      why: "Ένα μικρότερο αποτύπωμα προστατεύεται πιο εύκολα και συντηρείται πιο φθηνά."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 305–334 · ΝΟΕΜΒΡΙΟΣ · Αγορές & διαφημίσεις ===== */
    {
      id: "d305-dig", level: "dig", difficulty: 2,
      title: "Πριν την περίοδο των εκπτώσεων, κάνε διαγραφή από όλα τα newsletters καταστημάτων",
      why: "Τα email εκπτώσεων σχεδιάζονται για να δημιουργούν βιασύνη. Χωρίς αυτά, ψωνίζεις μόνο όταν αποφασίζεις εσύ."
    },
    {
      id: "d306-dig", level: "dig", difficulty: 1,
      title: "Αφαίρεσε αποθηκευμένες κάρτες από ιστότοπους αγορών που χρησιμοποιείς σπάνια",
      why: "Οι αποθηκευμένες κάρτες κάνουν τις παρορμητικές αγορές χωρίς κόπο και αυξάνουν τον κίνδυνο αν παραβιαστεί ένας ιστότοπος."
    },
    {
      id: "d307-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε τις ειδοποιήσεις από εφαρμογές αγορών",
      why: "Οι ειδοποιήσεις αγορών υπάρχουν για να σε κάνουν να αγοράσεις. Θα βρεις το κατάστημα όταν το χρειαστείς."
    },
    {
      id: "d308-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε εφαρμογές αγορών που χρησιμοποιείς μόνο περιστασιακά",
      why: "Η ιστοσελίδα λειτουργεί εξίσου καλά για περιστασιακές αγορές, με λιγότερο πειρασμό στην τσέπη σου."
    },
    {
      id: "d309-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πόσα email από καταστήματα σου έρχονται ακόμη;",
      why: "Καθένα είναι υποψήφιο για διαγραφή. Συνέχισε μέχρι να ησυχάσει το inbox σου."
    },
    {
      id: "d310-dig", level: "dig", difficulty: 1,
      title: "Άδειασε τα καλάθια αγορών στο διαδίκτυο",
      why: "Τα γεμάτα καλάθια είναι ανοιχτές αποφάσεις που σε τραβούν πίσω. Άδειασέ τα και ξεκίνα από την αρχή."
    },
    {
      id: "d311-dig", level: "dig", difficulty: 1,
      title: "Μετέφερε τα αντικείμενα της online λίστας επιθυμιών σε μια λίστα αναμονής 30 ημερών",
      why: "Η αναμονή ξεχωρίζει τις πραγματικές ανάγκες από τις περαστικές επιθυμίες. Τα περισσότερα δεν θα αντέξουν τον μήνα."
    },
    {
      id: "d312-dig", level: "dig", difficulty: 1,
      title: "Απενεργοποίησε την αγορά με ένα κλικ όπου είναι ενεργή",
      why: "Λίγη τριβή στο ταμείο σου δίνει μια στιγμή να το ξανασκεφτείς."
    },
    {
      id: "d313-dig", level: "dig", difficulty: 2,
      title: "Χρησιμοποίησε τις ρυθμίσεις απορρήτου ή προστασίας από παρακολούθηση του browser για λιγότερες διαφημίσεις",
      why: "Λιγότερες διαφημίσεις που σε ακολουθούν σημαίνουν λιγότερες υπενθυμίσεις για πράγματα που δεν χρειαζόσουν."
    },
    {
      id: "d314-dig", level: "dig", difficulty: 1,
      title: "Σταμάτα να ακολουθείς εμπορικά σήματα στα κοινωνικά δίκτυα",
      why: "Οι λογαριασμοί των brands είναι διαφήμιση που έχεις προσκαλέσει στη ροή σου."
    },
    {
      id: "d315-dig", level: "dig", difficulty: 1,
      title: "Βάλε ειδοποιήσεις τιμής μόνο για πράγματα που είναι ήδη στη λίστα αναγκών σου",
      why: "Οι ειδοποιήσεις τιμής για τυχαία πράγματα γεννούν επιθυμία. Για προγραμματισμένες αγορές, γλιτώνουν χρήματα."
    },
    {
      id: "d316-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: έκανες παρορμητικές αγορές online αυτή την εβδομάδα;",
      why: "Χωρίς κριτική, μόνο επίγνωση. Πρόσεξε τι τις προκάλεσε."
    },
    {
      id: "d317-dig", level: "dig", difficulty: 1,
      title: "Σκέψου ψηφιακά δώρα ή δώρα-εμπειρίες: μαθήματα, εισιτήρια, μια συνδρομή που θα λατρέψουν",
      why: "Τα καλά επιλεγμένα δώρα-εμπειρίες φέρνουν χαρά χωρίς να αυξάνουν την ακαταστασία κανενός."
    },
    {
      id: "d318-dig", level: "dig", difficulty: 3,
      title: "Κάνε τις φωτογραφίες μιας χρονιάς από το κινητό ένα μικρό φωτογραφικό βιβλίο για δώρο",
      why: "Ένα τυπωμένο βιβλίο με τις καλύτερες στιγμές είναι προσωπικό, έχει νόημα και χρησιμοποιεί φωτογραφίες που αλλιώς θα έμεναν κρυμμένες."
    },
    {
      id: "d319-dig", level: "dig", difficulty: 1,
      title: "Κράτα τις εκκρεμείς επιστροφές και επιστροφές χρημάτων σε μια απλή λίστα",
      why: "Οι επιστροφές ξεχνιούνται και τα χρήματα δεν διεκδικούνται. Μια λίστα τα παρακολουθεί."
    },
    {
      id: "d320-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε παλιά email παραγγελιών και αποστολών, κρατώντας μόνο τις αποδείξεις που χρειάζεσαι",
      why: "Οι ενημερώσεις αποστολής και τα «η παραγγελία σου στάλθηκε» δεν έχουν αξία μετά την παράδοση."
    },
    {
      id: "d321-dig", level: "dig", difficulty: 1,
      title: "Απόφυγε τις επιλογές «αγόρασε τώρα, πλήρωσε αργότερα» για μη απαραίτητα",
      why: "Όταν χωρίζεις τις πληρωμές, τα έξοδα μοιάζουν μικρότερα από όσο είναι. Πλήρωνε μόνο ό,τι μπορείς να αντέξεις τώρα."
    },
    {
      id: "d322-dig", level: "dig", difficulty: 1,
      title: "Εβδομάδα εκπτώσεων: άνοιγε ιστότοπους αγορών μόνο με τη λίστα σου στο χέρι",
      why: "Μια λίστα αποφασισμένη από πριν είναι η καλύτερη άμυνα απέναντι σε αντίστροφες μετρήσεις και «περιορισμένες προσφορές»."
    },
    {
      id: "d323-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: τήρησες τη λίστα σου στις εκπτώσεις;",
      why: "Όποια κι αν είναι η απάντηση, πρόσεξε τι λειτούργησε και τι σε έβαλε σε πειρασμό."
    },
    {
      id: "d324-dig", level: "dig", difficulty: 1,
      title: "Ενεργοποίησε ειδοποιήσεις δαπανών από την τράπεζά σου",
      why: "Οι ειδοποιήσεις σε πραγματικό χρόνο για ό,τι ξοδεύεις σε κρατούν ενήμερο/η χωρίς συνεχή έλεγχο."
    },
    {
      id: "d325-dig", level: "dig", difficulty: 1,
      title: "Μπλόκαρε ή κάνε διαγραφή από διαφημιστικά SMS",
      why: "Τα διαφημιστικά SMS συνήθως περιλαμβάνουν τρόπο διαγραφής. Χρησιμοποίησέ τον κάθε φορά."
    },
    {
      id: "d326-dig", level: "dig", difficulty: 2,
      title: "Κλείσε λογαριασμούς σε καταστήματα που δημιούργησες για μία μόνο αγορά",
      why: "Οι λογαριασμοί μιας χρήσης κρατούν τη διεύθυνση και το ιστορικό πληρωμών σου. Κλείσ' τους όταν τελειώσεις."
    },
    {
      id: "d327-dig", level: "dig", difficulty: 1,
      title: "Μην ψάχνεις προσφορές από βαρεμάρα",
      why: "Η περιήγηση στις εκπτώσεις για διασκέδαση είναι ο τρόπος που γίνονται οι απρογραμμάτιστες αγορές. Βρες άλλον τρόπο να ξεκουραστείς."
    },
    {
      id: "d328-dig", level: "dig", difficulty: 1,
      title: "Εξέτασε τι αγόρασες στις εκπτώσεις: υπάρχει κάτι για επιστροφή;",
      why: "Οι προθεσμίες επιστροφής είναι ακόμη ανοιχτές. Είναι η καλύτερη στιγμή να αναιρέσεις μια μεταμέλεια."
    },
    {
      id: "d329-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: κάνε διαγραφή από τις νέες λίστες που πρόσθεσαν οι εκπτώσεις",
      why: "Κάθε αγορά συνήθως προσθέτει και ένα newsletter. Καθάρισέ τα πριν εγκατασταθούν."
    },
    {
      id: "d330-dig", level: "dig", difficulty: 1,
      title: "Δες ηλεκτρονικά βιβλία, παιχνίδια και ψηφιακά προϊόντα που αγόρασες σε έκπτωση αλλά δεν χρησιμοποίησες",
      why: "Η ψηφιακή ακαταστασία που αγοράστηκε σε έκπτωση είναι και πάλι ακαταστασία. Σημείωσέ το για την επόμενη φορά."
    },
    {
      id: "d331-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε εφαρμογές κουπονιών και προσφορών",
      why: "Οι εφαρμογές προσφορών σε κρατούν να ψωνίζεις πράγματα που δεν σκόπευες να αγοράσεις."
    },
    {
      id: "d332-dig", level: "dig", difficulty: 1,
      title: "Αναλογίσου: πόσες από τις αγορές σου αυτόν τον μήνα προκλήθηκαν από διαφημίσεις;",
      why: "Όταν βλέπεις την επιρροή της διαφήμισης, επιλέγεις πιο ελεύθερα."
    },
    {
      id: "d333-dig", level: "dig", difficulty: 1,
      title: "Απολογισμός Νοεμβρίου: ποια αλλαγή σε προστάτεψε περισσότερο από τις παρορμητικές αγορές;",
      why: "Κράτα αυτή την αλλαγή ενεργή όλη τη χρονιά, όχι μόνο στις εκπτώσεις."
    },
    {
      id: "d334-dig", level: "dig", difficulty: 2,
      title: "Κάνε λίστα με τους βασικούς λογαριασμούς σου και πώς θα μπορούσε ένα έμπιστο πρόσωπο να έχει πρόσβαση σε περίπτωση ανάγκης",
      why: "Ένα σχέδιο ψηφιακής κληρονομιάς γλιτώνει τους αγαπημένους σου από μια επώδυνη αναζήτηση. Φύλαξέ το με ασφάλεια."
    },
    /* ===== ΨΗΦΙΑΚΗ ΡΟΗ — ΗΜΕΡΕΣ 335–365 · ΔΕΚΕΜΒΡΙΟΣ · Ψηφιακή κληρονομιά, αντίγραφα & απολογισμός ===== */
    {
      id: "d335-dig", level: "dig", difficulty: 2,
      title: "Όρισε επαφή κληρονομιάς ή διαχείρισης ανενεργού λογαριασμού, όπου το προσφέρουν οι υπηρεσίες σου",
      why: "Αρκετές μεγάλες υπηρεσίες σου επιτρέπουν να επιλέξεις ποιος θα έχει πρόσβαση ή θα διαχειρίζεται τον λογαριασμό σου μετά από μεγάλη αδράνεια ή θάνατο."
    },
    {
      id: "d336-dig", level: "dig", difficulty: 1,
      title: "Πες σε ένα έμπιστο πρόσωπο πού φυλάσσονται οι οδηγίες σου για περίπτωση ανάγκης",
      why: "Ένα σχέδιο που δεν το ξέρει κανείς δεν βοηθά. Μία κουβέντα αρκεί."
    },
    {
      id: "d337-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πώς νιώθεις που υπάρχει πλέον ένα σχέδιο;",
      why: "Η προετοιμασία για τα δύσκολα είναι πράξη φροντίδας που φέρνει ηρεμία."
    },
    {
      id: "d338-dig", level: "dig", difficulty: 3,
      title: "Κάνε ένα πλήρες αντίγραφο ασφαλείας τέλους χρονιάς για όλες τις συσκευές σου",
      why: "Το τέλος της χρονιάς είναι μια εύκολη ημερομηνία για να θυμάσαι το πλήρες αντίγραφο ασφαλείας. Συμπερίλαβε κινητά, υπολογιστές και φωτογραφίες."
    },
    {
      id: "d339-dig", level: "dig", difficulty: 2,
      title: "Καθάρισε σωστά τις παλιές συσκευές και μετά χάρισέ τες ή ανακύκλωσέ τες",
      why: "Μια επαναφορά εργοστασιακών ρυθμίσεων αφού αποσυνδεθείς από τους λογαριασμούς σου προστατεύει τα δεδομένα σου. Μετά δώσε στη συσκευή δεύτερη ζωή."
    },
    {
      id: "d340-dig", level: "dig", difficulty: 1,
      title: "Στείλε λίγα προσωπικά γιορτινά μηνύματα αντί για ένα μαζικό",
      why: "Ένα προσωπικό μήνυμα σε λίγους ανθρώπους σημαίνει περισσότερα από μια προωθημένη εικόνα σε όλους."
    },
    {
      id: "d341-dig", level: "dig", difficulty: 1,
      title: "Σχεδίασε χρόνο χωρίς κινητά με οικογένεια ή φίλους στις γιορτές",
      why: "Οι γιορτές είναι για να είμαστε μαζί. Συμφωνήστε σε στιγμές που τα κινητά μένουν μακριά."
    },
    {
      id: "d342-dig", level: "dig", difficulty: 1,
      title: "Σίγασε τις πολυάσχολες γιορτινές ομαδικές συνομιλίες μόλις κανονιστούν τα σχέδια",
      why: "Μπορείς να ελέγχεις όταν χρειάζεται χωρίς δεκάδες ειδοποιήσεις τη μέρα."
    },
    {
      id: "d343-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: οι οθόνες προσθέτουν ή αφαιρούν από τις γιορτές σου;",
      why: "Πρόσεξε πού οι συσκευές φέρνουν τους ανθρώπους κοντά και πού τους απομακρύνουν."
    },
    {
      id: "d344-dig", level: "dig", difficulty: 2,
      title: "Φτιάξε ένα άλμπουμ «τα καλύτερα της χρονιάς» με τις αγαπημένες σου φωτογραφίες",
      why: "Ένα σύντομο άλμπουμ με τις καλύτερες στιγμές της χρονιάς είναι κάτι που πραγματικά θα ξαναδείς."
    },
    {
      id: "d345-dig", level: "dig", difficulty: 2,
      title: "Διέγραψε τις περιττές φωτογραφίες της χρονιάς: διπλές, στιγμιότυπα και θολές λήψεις",
      why: "Όταν κλείνεις τη χρονιά με καθαρή βιβλιοθήκη, οι αναμνήσεις της επόμενης απολαμβάνονται πιο εύκολα."
    },
    {
      id: "d346-dig", level: "dig", difficulty: 2,
      title: "Πέρασε μια μέρα των γιορτών εντελώς χωρίς οθόνες",
      why: "Μια ολόκληρη μέρα παρουσίας είναι δώρο για σένα και για τους ανθρώπους γύρω σου."
    },
    {
      id: "d347-dig", level: "dig", difficulty: 1,
      title: "Ρύθμισε κάθε νέα συσκευή με ελάχιστες ειδοποιήσεις από την αρχή",
      why: "Είναι πιο εύκολο να κρατήσεις μια συσκευή ήρεμη από την πρώτη μέρα παρά να τη διορθώσεις αργότερα."
    },
    {
      id: "d348-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: ποια ψηφιακή συνήθεια έκανε αυτή την περίοδο πιο ήρεμη;",
      why: "Πρόσεξε τι βοήθησε, ώστε να το ξαναχρησιμοποιήσεις του χρόνου."
    },
    {
      id: "d349-dig", level: "dig", difficulty: 1,
      title: "Δες τον χρόνο οθόνης σου για ολόκληρη τη χρονιά",
      why: "Όταν βλέπεις τη μεγάλη εικόνα, φαίνεται πώς άλλαξαν πραγματικά οι συνήθειές σου."
    },
    {
      id: "d350-dig", level: "dig", difficulty: 1,
      title: "Κάνε διαγραφή από newsletters και λίστες που μπήκες φέτος αλλά δεν διαβάζεις",
      why: "Κλείσε τη χρονιά με ένα inbox που περιέχει μόνο ό,τι θέλεις."
    },
    {
      id: "d351-dig", level: "dig", difficulty: 1,
      title: "Διέγραψε εφαρμογές που εγκατέστησες φέτος αλλά χρησιμοποιείς σπάνια",
      why: "Οι νέες εφαρμογές τρυπώνουν όλη τη χρονιά. Ένα ξεκαθάρισμα στο τέλος της κρατά το κινητό σου ελαφρύ."
    },
    {
      id: "d352-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε το ιστορικό, τα cookies και τα αποθηκευμένα δεδομένα φορμών του browser για ένα φρέσκο ξεκίνημα",
      why: "Ένας χρόνος αποθηκευμένων δεδομένων περιήγησης είναι κυρίως παρακολούθηση και ακαταστασία. Οι σημαντικοί σου κωδικοί είναι ασφαλείς στον διαχειριστή κωδικών."
    },
    {
      id: "d353-dig", level: "dig", difficulty: 2,
      title: "Μετέφερε τα ολοκληρωμένα αρχεία της χρονιάς σε έναν φάκελο με το όνομα της χρονιάς",
      why: "Ένα ετήσιο αρχείο κρατά τους τρέχοντες φακέλους καθαρούς και την παλιά δουλειά εύκολη στην εύρεση."
    },
    {
      id: "d354-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: για τι είσαι πιο περήφανος/η στην ψηφιακή σου ζωή φέτος;",
      why: "Η αναγνώριση της προόδου σου δίνει κίνητρο να συνεχίσεις."
    },
    {
      id: "d355-dig", level: "dig", difficulty: 1,
      title: "Αρχειοθέτησε τα email της χρονιάς και ξεκίνα τη νέα χρονιά με καθαρό inbox",
      why: "Όλα μένουν αναζητήσιμα. Η νέα χρονιά ξεκινά χωρίς παλιό βάρος."
    },
    {
      id: "d356-dig", level: "dig", difficulty: 2,
      title: "Κάνε τον έλεγχο υγείας του διαχειριστή κωδικών: διόρθωσε αδύναμους ή επαναλαμβανόμενους κωδικούς",
      why: "Οι περισσότεροι διαχειριστές επισημαίνουν αδύναμους, επαναλαμβανόμενους ή διαρρεύσαντες κωδικούς. Αν διορθώσεις μερικούς, κλείνεις τη χρονιά με ασφάλεια."
    },
    {
      id: "d357-dig", level: "dig", difficulty: 1,
      title: "Γράψε τους προσωπικούς σου ψηφιακούς κανόνες για την επόμενη χρονιά",
      why: "Λίγοι σαφείς κανόνες, όπως «όχι κινητό στην κρεβατοκάμαρα», μεταφέρουν όσα κέρδισες φέτος στην επόμενη χρονιά."
    },
    {
      id: "d358-dig", level: "dig", difficulty: 1,
      title: "Διάλεξε έναν ψηφιακό στόχο για την επόμενη χρονιά",
      why: "Μία σαφής πρόθεση είναι πιο δυνατή από μια μεγάλη λίστα αποφάσεων."
    },
    {
      id: "d359-dig", level: "dig", difficulty: 1,
      title: "Στείλε ένα ευχαριστήριο μήνυμα σε κάποιον που σε βοήθησε φέτος",
      why: "Η τεχνολογία στην καλύτερη εκδοχή της συνδέει ανθρώπους. Χρησιμοποίησέ τη για ευγνωμοσύνη."
    },
    {
      id: "d360-dig", level: "dig", difficulty: 1,
      title: "Εβδομαδιαίος έλεγχος: πώς νιώθεις το κινητό σου σε σχέση με πριν από έναν χρόνο;",
      why: "Πιο ήρεμο, πιο ελαφρύ, πιο χρήσιμο: πρόσεξε κάθε διαφορά."
    },
    {
      id: "d361-dig", level: "dig", difficulty: 1,
      title: "Τακτοποίησε την αρχική οθόνη του κινητού για τη νέα χρονιά",
      why: "Ξεκίνα τη χρονιά έχοντας σε κοινή θέα μόνο τα εργαλεία που σε εξυπηρετούν."
    },
    {
      id: "d362-dig", level: "dig", difficulty: 1,
      title: "Καθάρισε την επιφάνεια εργασίας του υπολογιστή για τη νέα χρονιά",
      why: "Μια καθαρή επιφάνεια εργασίας την πρώτη εργάσιμη μέρα δίνει τον τόνο για όλη τη χρονιά."
    },
    {
      id: "d363-dig", level: "dig", difficulty: 1,
      title: "Την παραμονή της Πρωτοχρονιάς, άφησε το κινητό στην άκρη τα μεσάνυχτα και να είσαι με τους ανθρώπους γύρω σου",
      why: "Η στιγμή βιώνεται καλύτερα από όσο καταγράφεται. Στείλε τις ευχές σου το επόμενο πρωί."
    },
    {
      id: "d364-dig", level: "dig", difficulty: 1,
      title: "Κλείσε τον κύκλο: απενεργοποίησε τις ειδοποιήσεις μιας ακόμη εφαρμογής, όπως την Ημέρα 1",
      why: "Η ίδια μικρή κίνηση, έναν χρόνο μετά, δείχνει πόσο φυσικές έχουν γίνει αυτές οι επιλογές."
    },
    {
      id: "d365-dig", level: "dig", difficulty: 1,
      title: "Αναλογίσου: πώς νιώθεις την ψηφιακή σου ζωή μετά από μια χρονιά μικρών αλλαγών;",
      why: "Ο ψηφιακός μινιμαλισμός δεν σημαίνει λιγότερη τεχνολογία για τον εαυτό της, αλλά τεχνολογία με σκοπό. Χάρου τη διαδρομή που έκανες."
    }
  ]
};