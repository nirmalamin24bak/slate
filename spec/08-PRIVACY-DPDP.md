# 08 — Privacy & DPDP

> Not legal advice. Nirmal should spend an hour with counsel before launch — the same tier of thing as the company registration and the trademark filing.

---

## What applies

India's **Digital Personal Data Protection Act, 2023**. The DPDP Rules were notified **14 November 2025**, with substantive provisions phasing in over 18 months.

- **Now → Nov 2026:** soft enforcement. Guidance and warnings.
- **14 May 2027:** hard enforcement. The Data Protection Board moves to active supervision, with no expected grace period. Penalties reach ₹250 crore for failures of reasonable security safeguards.

Slate launches inside the build-and-test window. Build it right now rather than retrofit in 2027.

**Anonymity is not a shield.** Slate collects age, sex, height, weight, and a food diary. That is personal data, and it is health data. Sonal Systems is a Data Fiduciary regardless of whether a login screen exists.

---

## Obligations, translated into work

### 1. Standalone privacy notice — screen `O0`

Shown at first launch, before the BMR screen collects anything. Itemised, specific, plain:

- **What** we collect: age, sex, height, weight, what you eat, your calorie goal
- **Why**: to compute calories and show your trends. Nothing else.
- **Where**: stored in India (Supabase `ap-south-1`, Mumbai)
- **Who**: nobody. We do not sell data. We do not show ads.
- **Your rights**: access, correct, export, delete — all from Settings
- **Contact**: `support@slate.app`

Not a checkbox buried in a signup screen we don't have. A screen.

### 2. Right to erasure — `Delete my data`

Settings → `Delete my data`. In-app. Two taps and a confirm. Not an email address, not a support ticket.

```sql
-- hard delete, not soft. this is the one exception.
delete from auth.users where id = auth.uid();
-- cascades to profiles, kitchen, entries, weights, custom_dishes
```

RevenueCat entitlement is *not* deleted — it lives with the Apple ID and we don't own it. Say so on the confirm screen.

### 3. Right to access & portability — `Export your data`

Settings → `Export your data`. Free, always. Produces a JSON + CSV bundle: profile, kitchen, every entry with `raw_text` and computed nutrition, every weight.

### 4. Right to correct

Every entry is editable. Every profile field is editable. Already true by design.

### 5. Point of contact

A named person for data questions, published in the app and on the website. `support@slate.app` routing to a human, plus a grievance officer named in the privacy policy.

### 6. Breach notification

72 hours to notify both the Data Protection Board and affected users.

Write the playbook **before** launch, not during an incident: who declares, what the notification says, how we reach users without an email address (in-app banner + App Store update note).

### 7. Retention & purpose limitation

Delete personal data when the specified purpose is no longer served. Practically:

- An account with no entries for 24 months gets a warning email (if we have one) or an in-app notice, then deletion
- Processing logs retained one year, then purged
- `resolution_cache` holds no personal data — normalized phrases only, no `user_id`. Confirm this in code review.

---

## Architecture consequences

**Data residency.** Supabase project region `ap-south-1`. Set at creation; cannot be changed later without a migration.

**The resolver sends food text to a model.** That is a processor relationship. Requirements:
- Zero-retention endpoint, contractually
- No training on our data
- Named in the privacy notice as a processor
- If the model is hosted outside India, disclose the transfer

**Analytics never sees `raw_text`.** Resolved `ref` only. See `07-MONETIZATION.md`.

**No ad SDKs.** Not now, not later. This is a values decision and a compliance simplification at once.

---

## Children

Slate is 18+. Age is collected on `O6`. If `age < 18`, do not proceed with BMR; show a plain message that Slate isn't built for under-18s and skip to the goal screen with no numbers.

DPDP requires verifiable parental consent for children's data. We avoid the entire regime by not collecting it. Set the App Store age rating accordingly.

---

## What we tell users, in the store listing

> No login. No ads. No data sold. Your entries stay in India, and you can export or delete all of them from Settings.

Every clause is a compliance obligation restated as a promise. That's the cheapest marketing in the category.
