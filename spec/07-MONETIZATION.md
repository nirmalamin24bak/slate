# 07 — Monetization

## Pricing

| Plan | Price | Notes |
|---|---|---|
| Monthly | **₹199** | |
| Yearly | **₹1,499** | −37%. Show the discount badge. |

7-day free trial on **yearly only**. Monthly converts immediately.

Apple IAP exclusively. No Razorpay — that's for non-app-store contexts. RevenueCat manages entitlements.

Compare: HealthifyMe's coaching plans run ₹999–₹1,699/month, and the loudest complaints about them are refunds, not features. ₹199 is priced to be forgettable. That's the point.

---

## Free / Plus

Free is the complete journal. Plus is everything around it.

| | Free | Plus |
|---|:---:|:---:|
| Unlimited entries | ✓ | ✓ |
| Freeform text logging | ✓ | ✓ |
| Exercise logging | ✓ | ✓ |
| Weight logging | ✓ | ✓ |
| Water logging | ✓ | ✓ |
| Steps (typed) | ✓ | ✓ |
| Barcode scanner | ✓ | ✓ |
| Label scanner | ✓ | ✓ |
| Macros | ✓ | ✓ |
| Streak | ✓ | ✓ |
| **Hide calorie counts** | ✓ | ✓ |
| **Export your data** | ✓ | ✓ |
| History | 30 days | Full |
| Sleep logging | | ✓ |
| Fiber & sugar | | ✓ |
| Stats | | ✓ |
| Kitchen calibration | | ✓ |
| Saved foods | | ✓ |
| Widgets | | ✓ |
| Photo logging | | ✓ |
| Chat | | ✓ |
| Apple Health import | | ✓ |
| Custom dishes | | ✓ |

> **⚠ Flagged — kitchen calibration behind Plus.** Calibration isn't a feature, it's the accuracy of the free tier's numbers. A free user with an uncalibrated 250ml katori gets numbers that are wrong in exactly the way every competitor's are — and writes the review saying so. The moat only works if everyone's numbers are calibrated; Plus should sell *more capability*, not *less wrongness*. Recorded as implemented-but-contested in MASTER.md. Nirmal can reverse with one word.

### Two entries that are free on principle

**Hide calorie counts.** Every other Plus feature is an upgrade — more data, more capability. This one is the affordance that lets someone with a difficult relationship to numbers use the journal at all. Charging for it means the users who most need it don't get it. It also costs nothing: a boolean that hides a column. Nobody upgrades to see less.

**Export your data.** DPDP makes this a right, not a feature. Charging for a legal obligation is a bad look and probably not lawful.

---

## Anonymous purchase

**A user can buy Plus without ever signing in.** On iOS this works, cleanly:

- App Store purchases attach to the buyer's **Apple ID**, not to any account we hold.
- RevenueCat issues an anonymous app user ID at install; the purchase binds to it.
- *Restore Purchases* reads the receipt from StoreKit. The entitlement survives reinstall and follows the Apple ID to a new phone.

**Alias the RevenueCat anonymous ID to the Supabase `auth.uid()`** at first launch. `Purchases.logIn(supabaseUserId)`. Then the entitlement and the data share an identity.

### The failure mode, named

Reinstall → new Supabase anonymous user → the subscription restores, the food log does not.

This is why *Sign in to sync across devices* exists in Settings. It is an **offer**, not a gate. Apple or Google, upgrading the same `auth.users` row in place. No migration, nothing lost.

Do not turn it into a wall. A Google Play reviewer of a competitor described logging their first meal, moving through six onboarding cards, then being forced to pick a paid plan to continue — and called it a scam. That review is worth more to us than a conversion point.

---

## Paywall placement

Once, immediately after `Start`, before the first log. Dismissible with `No thanks`.

Thereafter: a single green `Upgrade to Slate Plus` row at the top of Settings, and the teaser card on the photo scanner tab.

**No interstitials. No "you've used 3 of 5 free logs." No nagging.** The free tier is the product; Plus is a tip with benefits.

---

## Refunds

Purchases go through Apple, so refunds go through Apple. We do not hold the money and we do not adjudicate.

Say this plainly in the App Store description. It is the single sharpest differentiator against every Indian competitor, whose review pages are wall-to-wall refund disputes.

---

## Analytics

PostHog. Events, not people.

Track: install → onboarding completion by screen → first log → D1/D7/D30 retention → paywall view → conversion → cache hit rate → resolver p95 latency → `unresolved` rate.

**Never send `raw_text` to analytics.** It's food, it's health data, and it's theirs. Send the resolved `ref` and nothing more.

No ad SDKs. Ever. Slate does not have advertisers.
