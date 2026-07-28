# Slate privacy policy (draft)

DRAFT — counsel reviews before publishing; the grievance officer name is a founder decision and is a placeholder here.

This draft mirrors the itemized first-launch notice (screen O0) in `spec/08-PRIVACY-DPDP.md` §1, expanded to policy length. Slate is operated by Sonal Systems Private Limited, Vadodara, India, a Data Fiduciary under the Digital Personal Data Protection Act, 2023 (DPDP).

---

## 1. What we collect

- Age, sex, height, and weight, entered at onboarding.
- Your food entries: the text you type, and the foods they resolve to.
- Your calorie goal, which you set yourself.
- Weight entries you log over time.
- Optional exercise and step data, if you log or connect it.

Slate has no login. We do not collect your name, email address, or phone number. An anonymous account is created on install; it identifies your device's data, not you.

## 2. Why we collect it

To compute calories and show your trends. Nothing else.

- Age, sex, height, and weight compute your BMR and baseline.
- Food entries compute calories and macros from published food composition tables.
- Weight entries draw your chart.

We do not build profiles for advertising, do not score your habits, and do not use your data for any purpose beyond running the journal you see.

## 3. Where it is stored

In India. All data lives in Supabase's `ap-south-1` region (Mumbai). A copy sits on your device so the journal works offline.

## 4. Processors

We use a small number of service providers who process data on our instructions:

- **Resolver model provider** `[name — pending founder decision]`: the text of a food entry is sent to a language model to identify the food. The contract requires zero retention and no training on our data. If the provider hosts the model outside India, that transfer is disclosed here. `[Counsel: complete once the provider is signed.]`
- **Analytics processor** `[pending — see docs/analytics-handoff.md]`: if analytics goes live, it will be hosted in India, will never receive the text of your entries, and will be named here first.
- **Apple and RevenueCat** process subscription purchases. Payment details stay with Apple; we never see them.
- **Open Food Facts** (openfoodfacts.org, a non-profit database hosted in France): when you scan a barcode that is not already in our own packaged-foods table, that barcode is sent to them to look up the product. They receive the barcode and, unavoidably, your device's IP address. They receive nothing else — not your journal, not your name, not what you did with the result. This is a transfer outside India. `[Counsel: confirm the disclosure wording, and whether the transfer needs anything further under the notified Rules. Engineering alternative if it does — route the lookup through our own Edge Function so only Slate's server address reaches them; see audit M7.]`

We do not sell data to anyone, and no processor may use your data for its own purposes.

## 5. Who sees your data

Nobody. We do not sell data. We do not show ads. No advertising SDK exists in the app, and none will be added.

## 6. Your rights

All of these work from Settings, in the app, without contacting us:

- **Access and portability** (DPDP §11): Settings → Export your data. Free, always. Produces a JSON and CSV bundle with your profile, every entry including its original text, computed nutrition, and every weight.
- **Correction** (DPDP §12): every entry and every profile field is editable in place.
- **Erasure** (DPDP §12): Settings → Delete my data. A hard delete of your account and everything attached to it. Your subscription entitlement is not deleted because it lives with your Apple ID, which we do not control; the confirmation screen says so.
- **Grievance redressal** (DPDP §13): see section 9.

## 7. Retention

- An account with no entries for 24 months receives a notice (in-app, or by email if you have signed in with one), then is deleted.
- Processing logs are retained for one year, then purged.
- The resolution cache, which speeds up food lookups, holds normalized food phrases only. It contains no personal data and no account identifiers.

## 8. Children

Slate is for adults, rated 18+. Age is collected at onboarding; if it is under 18, Slate does not proceed with any calculation and collects nothing further. We do not knowingly collect data from anyone under 18.

## 9. Grievance officer

`[name — founder decision]`
Sonal Systems Private Limited, Vadodara, India
`support@slate.app`

Data questions and complaints go to this address and are read by a person.

## 10. Breach notification

If personal data is breached, we notify the Data Protection Board of India and affected users within 72 hours, as DPDP requires. Because most users have no email on file, notice is given by an in-app banner, an App Store update note, and a notice on our website.

## 11. Changes to this policy

Material changes are announced in the app before they take effect. The current version is always available in Settings and on our website.

`[Effective date: set at publication.]`
