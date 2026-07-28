# App Store compliance checklist (v1, iOS)

Tracked separately from the punch list because these are submission gates, not
features. Owner: **[FOUNDER — Nirmal]** for anything needing Apple account access.

## Done in code

- `ITSAppUsesNonExemptEncryption: false` in `app.json` → `ios.infoPlist`. Slate
  uses only standard HTTPS/TLS (Supabase, RevenueCat, PostHog, Anthropic via the
  edge function), which is exempt. Set here so App Store Connect stops prompting
  on every submission.
- `ios.buildNumber` seeded to `"1"`; `eas.json` production profile sets
  `autoIncrement: true`, so subsequent builds bump automatically.

## Needs an `eas init` / founder step before the first build

- **EAS project id.** Run `eas init` once; it writes `extra.eas.projectId` into
  `app.json`. Not committed here because it's created against the Expo account.
- **`eas.json` submit block** has `REPLACE_WITH_*` placeholders for the Apple ID,
  App Store Connect app id, and Apple team id. Fill before `eas submit`.

## Privacy manifest (`PrivacyInfo.xcprivacy`)

Apple requires a privacy manifest declaring "required reason" API usage and
third-party SDK data collection. Expo SDK 57 config plugins auto-generate a base
manifest for known APIs (AsyncStorage/UserDefaults, file timestamps via
expo-file-system/expo-sqlite). Before the first submission, **verify** the
generated manifest in the `eas build` output (or Xcode) covers:

- UserDefaults (`CA92.1`) — AsyncStorage.
- File timestamp (`C617.1`) / disk space (`E174.1`) — expo-sqlite / expo-file-system.
- Any reason codes RevenueCat / PostHog SDKs declare.

If a required SDK isn't covered by the auto-generated manifest, hand-author
`PrivacyInfo.xcprivacy` and add it to the iOS target.

## App Privacy "nutrition label" (App Store Connect questionnaire)

Answer against `spec/08-PRIVACY-DPDP.md`. Data linked to identity (auth.uid):

- **Health & Fitness** — the food/exercise/weight the user logs. Used for app
  functionality only. Linked to the (anonymous) user id. Not used for tracking.
- **Purchases** — via RevenueCat, for app functionality (entitlement). Linked.
- **Usage data** — PostHog product events (never raw_text). App functionality /
  analytics. Linked to the anonymous id. Not used for cross-app tracking.
- No data is shared with data brokers; no third-party ad SDKs exist.

App Tracking Transparency (ATT): **not required** — Slate does not track users
across apps/sites owned by other companies. No `NSUserTrackingUsageDescription`
is needed as long as that stays true.
