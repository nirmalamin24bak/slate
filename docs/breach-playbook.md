# Breach playbook

DRAFT — founders + counsel finalize before launch. Names in brackets are placeholders the founders fill.

Per `spec/08-PRIVACY-DPDP.md` §6: 72 hours to notify both the Data Protection Board and affected users. This playbook exists so nobody writes it during an incident.

---

## Who declares

- Decision owner: `[founder: Nirmal or Nehal]`. They alone declare a breach.
- Deputy: `[the other founder]`, if the owner is unreachable for more than 2 hours.
- The 72-hour clock starts at declaration. Declaration is a written note (time-stamped message in the founders' channel) stating what is suspected and which systems are affected.

If in doubt, declare. Un-declaring a false alarm costs nothing. A late declaration costs the full DPDP penalty exposure.

## Clock

| Time  | Action                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| T+0   | Declare. Freeze affected systems: rotate service keys, revoke suspect sessions, snapshot logs before they cycle.                           |
| T+12h | Scope assessment: which tables, which users, what window. Run the RLS audit against every table. Write down what is known and what is not. |
| T+24h | Draft both notifications (Board and users). Counsel reviews the drafts.                                                                    |
| T+48h | Board notification sent to the Data Protection Board.                                                                                      |
| T+72h | User notification live: in-app banner on, App Store note submitted, website notice published.                                              |

## How we reach users

Slate has no email addresses for most users. Three channels, all prepared before launch:

1. **In-app banner.** Ships in the app behind a remote flag, off by default. Turning the flag on shows the banner to every user on next open. No app update required.
2. **App Store update note.** The next release's notes carry the notice verbatim.
3. **Website notice.** A dated page on the Slate website, linked from the banner.

### Banner copy (drafted, counsel adjusts facts per incident)

> Some Slate data was accessed without authorisation between `[date]` and `[date]`. What was affected: `[data categories]`. Your entries are otherwise intact. You can export or delete your data from Settings. Details: `[website link]`.

Flat, factual, actionable. No apology, no reassurance beyond the facts, no exclamation marks.

## What the notification says

Both the Board and user notifications state, in plain language:

- **What data** was affected (categories, not speculation).
- **What window** the exposure covers.
- **What we did**: containment steps taken and when.
- **What the user can do**: export their data or delete their account, both from Settings, both free.
- **Who to contact**: the grievance officer, `[name — founder decision]`, via `support@slate.app`.

The Board notification additionally includes the timeline of detection, declaration, and containment.

## Post-incident

- [ ] Root-cause document within 14 days of declaration. What failed, why the safeguard missed it, what changed.
- [ ] Retention purge check: confirm processing logs older than 1 year and inactive-account data past the 24-month window were actually purged, since stale data widens every breach.
- [ ] Re-run the RLS cross-user test suite and record the run (date, commit, result) in the root-cause document.
- [ ] Update this playbook with what the incident taught.
