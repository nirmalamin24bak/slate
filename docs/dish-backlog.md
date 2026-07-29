# Dish backlog — 55 to 400–600

The table is at **55**. This is the list of what goes in the other ~400, ordered so the
first hundred remove more `unresolved` than the last three hundred.

How to use it: take a batch, write the recipes, follow `docs/dish-table-workflow.md`. Tick
names off here in the same commit. Do not work alphabetically and do not work top-to-bottom
inside a section — work section by section, because the sections are the priority.

**The ordering principle:** how often a 24–35 year old in Vadodara types this and gets
nothing back. A dish they eat weekly beats a dish that is more famous.

---

## Ingredient reality check

IFCT 2017 is much richer than the 42 refs in `scripts/ifct/ref-map.json` suggest. Spot-checked
29 Jul 2026: it carries goat (13 cuts), 60+ fish, prawn, 4 mushrooms, khoa, ghee, paneer,
jaggery, tapioca, sago, almond/walnut/pistachio/raisin/dates, poppy seeds, coconut, 21 brinjal
varieties, bottle/bitter/ash/ridge gourd, colocasia, drumstick, cowpea, horse gram, moth bean,
soya, ragi/bajra/jowar/maize/barley, amaranth.

So for nearly everything below, adding an ingredient is **a line in `ref-map.json`**, not
lineage work in `supplemental.json`. Search IFCT by its own English/botanical naming, not the
Hinglish name — "field bean" is surti papdi, "colocasia" is arbi, "curry leaves" is kadi patta.

Genuinely absent and needing `supplemental.json` with lineage: **butter**, **cream** (done,
`SUPP_CREAM`), **sesame/til**, and most **packaged and chain items**.

**Known defect, unfixed:** `dish_kadhi` and `dish_dal_dhokli` map jaggery to the `sugar` ref
and their notes claim IFCT has no jaggery row. It does — `I001`, 353.7 kcal/100 g. Worth ~2 kcal
on those two, so no re-pin, but fix the mapping before any jaggery-dominant sweet goes in.

---

## Batch 1 — Gujarati home table (~45)

The single highest-value block. This is the food the target user eats on a Tuesday.

**Sabzi / shaak:** undhiyu, ringan no olo, bharela ringan, ringan bataka, oro, sambharo,
gujarati bataka nu shaak, dudhi nu shaak, tindora nu shaak, gawar nu shaak, valor nu shaak,
papdi nu shaak, karela nu shaak, methi bataka, tuvar lilva nu shaak, kobi vatana, guvar dhokli,
sev khamani, bataka poha nu shaak, lasaniya bataka, mixed veg shaak, dudhi chana, kathol

**Dal / kadhi:** gujarati dal, osaman, lilva kachori dal, dal vada, kathiyawadi dal, sev usal

**Farsan / steamed:** handvo, muthiya, khaman, khandvi, patra, dhokla varieties (khatta,
rasawala, cheese), locho, sev khamani, ghughra, dal vada, gota, methi gota, bhajiya, kand na
bhajiya, ratalu

**Breads:** bajra rotlo, jowar rotlo, makai rotlo, puran poli, methi thepla, dudhi thepla,
masala rotli, bhakri, khichu

---

## Batch 2 — North Indian home + restaurant (~70)

Everything already reachable by alias but returning nothing.

**Paneer:** paneer bhurji, kadai paneer, shahi paneer, matar paneer, malai kofta, paneer
lababdar, paneer kolhapuri, chilli paneer, paneer 65, achari paneer, methi malai paneer

**Dals:** dal tadka, dal fry, chana dal, lobia, kala chana, dal panchmel, urad dal, moong dal
tadka, sambhar dal, amritsari dal, langar wali dal

**Sabzi:** aloo gobi, gobi matar, baingan bharta, jeera aloo, dum aloo, aloo methi, aloo palak,
lauki kofta, kadai veg, veg kolhapuri, veg jalfrezi, mix veg, sarson ka saag, matar mushroom,
mushroom masala, soya chaap, kathal sabzi, tinda, arbi masala, karela bharwa, bharwa shimla

**Restaurant gravies:** navratan korma, veg makhanwala, malai chaap, dal bukhara, rajma
masala, chole bhature, amritsari chole, pindi chole

**Breads:** naan, butter naan, garlic naan, kulcha, amritsari kulcha, tandoori roti, rumali
roti, missi roti, lachha paratha, laccha naan, bhatura, makki di roti, khameeri roti

---

## Batch 3 — South Indian (~55)

Vadodara has a real South Indian eating-out habit. Idli/dosa are in; the rest are not.

**Dosa:** rava dosa, onion dosa, mysore masala dosa, paper dosa, set dosa, neer dosa, pesarattu,
ghee roast, cheese dosa, butter masala dosa, uttapam (plain, onion, tomato, mixed)

**Idli / steamed:** rava idli, button idli, kanchipuram idli, idiyappam, puttu, appam, kozhukattai

**Rice:** lemon rice, tamarind rice (puliyogare), coconut rice, tomato rice, bisi bele bath,
curd rice (in), vangi bath, ven pongal, sweet pongal, ghee rice

**Tiffin:** upma varieties (rava in, semiya, oats, bread), khara bath, kesari bath, poori masala,
vada (medu in, masala, dahi), rasam vada, sambar vada

**Curry:** rasam, tomato rasam, pepper rasam, mor kuzhambu, avial, olan, thoran, poriyal,
kootu, sambar (in), kara kuzhambu, chettinad curry, kerala fish curry, appam stew

---

## Batch 4 — Street food and chaat (~45)

High type-frequency, low ingredient complexity, high calorie variance — worth getting right.

pani puri, dahi puri, sev puri, ragda pattice, ragda, dabeli, frankie, veg roll, kathi roll,
chicken roll, momos (steamed, fried, tandoori), spring roll, manchurian, chowmein, hakka noodles,
schezwan noodles, chilli potato, honey chilli potato, aloo tikki, tikki chaat, papdi chaat,
dahi bhalla, samosa chaat, kachori, raj kachori, pyaaz kachori, lilva kachori, matar kachori,
chole tikki, bread pakoda, vada pav (in), misal pav, usal pav, pav bhaji (in), masala pav,
tawa pulao, egg roll, bhurji pav, khada pav, corn chaat, chana chaat, sprouts chaat,
grilled sandwich, cheese sandwich, bombay sandwich

---

## Batch 5 — Rice, biryani, pulao (~25)

pulao (veg, matar, jeera in), kashmiri pulao, hyderabadi biryani, lucknowi biryani,
egg biryani, mutton biryani, prawn biryani, tehri, khichuri, masala bhaat, curd rice (in),
fried rice (veg in, egg, chicken, schezwan), burnt garlic rice, dal khichdi (in),
sabudana khichdi, brown rice, quinoa, millet khichdi

---

## Batch 6 — Non-veg (~40)

Vadodara skews vegetarian, but the users who eat meat log it constantly and get nothing.

**Chicken:** butter chicken, chicken tikka, tandoori chicken, chicken 65, chilli chicken,
kadai chicken, chicken korma, chicken bharta, chicken lollipop, chicken keema, chicken curry
(in), chettinad chicken, chicken ghee roast, malai tikka, afghani chicken, chicken shawarma,
chicken momos, chicken sandwich, chicken soup

**Mutton:** mutton curry, rogan josh, mutton keema, keema pav, mutton kolhapuri, nihari,
paya, mutton seekh kebab, galouti kebab, mutton chaap

**Fish / seafood:** fish curry, fish fry, fish tikka, amritsari fish, prawn curry, prawn fry,
tandoori pomfret, crab masala

**Egg:** egg curry, egg bhurji (in), egg omelette (in), egg boiled (in), egg fried rice,
half fry, akuri, egg maggi, anda pav

---

## Batch 7 — Snacks and farsan (~35)

What people eat between meals and never log accurately.

chakli, mathri, namkeen mix, farsan mix, ganthiya, fafda, jalebi-fafda, khakhra (in), sev (in),
bhujia, aloo bhujia, moong dal namkeen, masala peanuts, roasted chana, makhana, popcorn,
banana chips, potato chips, wafers, nachos, mixture, chivda, poha chivda, batata sev,
murukku, ribbon pakoda, thattai, mullu murukku, bhakarwadi, samosa (in), patties, puff,
veg puff, egg puff, cutlet

---

## Batch 8 — Sweets and mithai (~45)

Highest calorie density in the table and the most-guessed category.

**Gujarati:** sukhdi, mohanthal, magas, ghari, basundi, shrikhand, mango shrikhand, doodhpak,
lapsi, churma ladoo, dudhi halwa

**North:** gulab jamun, rasgulla, rasmalai, jalebi, imarti, kaju katli, besan ladoo,
motichoor ladoo, boondi ladoo, barfi (plain, kaju, coconut, chocolate), peda, kalakand, sohan
papdi, gajar halwa, moong dal halwa, suji halwa, atta halwa, malpua, gujiya, balushahi,
rabri, kheer, sevai kheer, phirni, shahi tukda

**South:** mysore pak, payasam, kesari (in section 3), ada pradhaman, obbattu

**Everyday:** ice cream (vanilla, chocolate, butterscotch), kulfi, falooda, cake slice, pastry,
brownie, chocolate, biscuits, rusk, cookies

---

## Batch 9 — Beverages (~30)

Typed constantly, small numbers, easy wins.

chai (in), masala chai, adrak chai, black tea, green tea, coffee, filter coffee, cold coffee,
cappuccino, latte, espresso, black coffee, milk, hot milk, badam milk, haldi doodh, buttermilk
(chaas in), lassi (in), mango lassi, sweet lassi, salt lassi, nimbu pani, aam panna, sugarcane
juice, coconut water, orange juice, mosambi juice, mixed fruit juice, smoothie, banana shake,
mango shake, chocolate shake, cola, lemon soda, jaljeera, thandai, energy drink, beer, wine,
whisky peg, rum, vodka

---

## Batch 10 — Fruits, salads, raw (~35)

mango, papaya, guava, orange, mosambi, grapes, pomegranate, watermelon, muskmelon, pineapple,
chikoo, custard apple, jamun, ber, litchi, pear, peach, plum, strawberry, kiwi, dates,
raisins, figs, almonds, cashews (in as ingredient), walnuts, pistachio, peanuts (in),
mixed nuts, cucumber salad, kachumber, green salad, sprouts, corn, boiled chana, fruit salad

---

## Batch 11 — Café, continental, "healthy" (~40)

The urban 24–35 bracket eats this more than the regional lists admit.

pasta (red, white, pink sauce), penne arrabbiata, mac and cheese, lasagna, pizza (margherita,
farmhouse, pepperoni, cheese burst), garlic bread, cheese garlic bread, burger (veg, chicken,
aloo tikki, cheese), fries, peri peri fries, wedges, wrap, quesadilla, taco, nachos, sub,
club sandwich, grilled cheese, soup (tomato, sweetcorn, manchow, hot and sour), salad bowl,
caesar salad, oats, overnight oats, muesli, cornflakes, granola, peanut butter toast, avocado
toast, boiled eggs (in), protein shake, whey, protein bar, smoothie bowl, poha (in), upma (in),
besan chilla (in), moong chilla, oats chilla, quinoa salad

---

## Batch 12 — Packaged and chain (~50)

Different pipeline: these go in `packaged_foods`, not `dishes`, and most need
`supplemental.json` or a barcode lookup rather than an IFCT lineage.

**Biscuits:** Parle-G, Marie, Good Day, Bourbon, Oreo, Hide & Seek, Krackjack, Monaco,
Digestive, NutriChoice

**Namkeen:** Haldiram bhujia, Aloo bhujia, Kurkure, Lays, Bingo, Uncle Chips, Balaji wafers

**Chocolate:** Dairy Milk, 5 Star, Perk, KitKat, Munch, Snickers, Bournville, Ferrero

**Instant:** Maggi (in), Yippee, Top Ramen, Knorr soup, Cup Noodles, MTR ready meals,
Haldiram ready meals

**Dairy:** Amul butter, Amul cheese slice, cheese cube, Amul lassi, Masti dahi, Epigamia,
Amul ice cream, Go cheese

**Chains:** McAloo Tikki, McVeggie, McChicken, Domino's slice, Subway 6-inch, KFC bucket piece,
Starbucks latte, CCD cappuccino, Haldiram thali

---

## Sequencing note

Batches 1–4 are ~215 dishes and cover the overwhelming majority of what the target user types.
If the schedule tightens, ship at 270 total (55 + 215) rather than delaying for 600. Batches
10, 11 and 12 are individually cheap but individually low-value — they are the tail, and the
tail is what a resolver fallback plus `unresolved` telemetry should be used to prioritise once
the app is live, rather than guessed at now.

**Do not batch more than 10–20 dishes at a time.** The band is a review step and review does
not scale past a sitting.
