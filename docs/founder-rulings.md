# Founder rulings — every open `FLAG(nirmal)`, with a recommendation

Status: **open, awaiting Nirmal.** Written 28 Jul 2026 by sweeping `git grep FLAG(nirmal)`
across the repo. Nothing here has been changed unilaterally: CLAUDE.md says if a decision
isn't in `MASTER.md` it wasn't decided, and inventing a default is not allowed. So each item
below states the value the code carries today, why it was flagged, the argument, and the
exact edit that applies a ruling. One word from you closes most of them.

The nutrition data flags were ruled on 13 Jul and are recorded in
[`nutrition-verification.md`](nutrition-verification.md) — this sheet covers what that one
left open, plus everything outside nutrition.

Ruling format that works: reply with the item number and the choice. I apply the edit,
record it in `MASTER.md` (decision + reason), and delete the flag.

---

## A. Rulings that gate the launch

### A1. Resolver model provider + DPDP processor terms

`supabase/functions/resolver-classify/providers.ts:1-11`, `.env.example`

Code today: `anthropic` / `claude-haiku-4-5`, swappable in that one file by design.
`RESOLVER_PROVIDER_API_KEY` is unset, so the resolver has never run.

This is the hard gate, and it is not really a technical choice. spec/08 requires the
provider be a **processor** under contract: zero retention, no training on our data, named
in the privacy notice. Until the terms are signed and the provider named, the privacy policy
cannot publish and the Phase-2 accuracy gate cannot be measured.

**Recommendation:** keep Anthropic Haiku as the candidate, sign zero-retention terms, then
run the eval before committing. If the terms take time, the same file swaps in one edit —
nothing else in the system knows a vendor name.

### A2. Final URLs and support identity

`src/components/Drawer.tsx:15-17`, `app/settings/index.tsx:15-17`

Code today: `https://slate.app` (share), `https://slate.app/privacy`, `support@slate.app`.
All three are placeholders. The App Store link cannot exist before the listing does, but the
privacy URL and support mailbox must be live **before** submission — App Review checks the
privacy link, and DPDP requires a reachable grievance channel.

**Recommendation:** register the domain and the mailbox now; they are cheap and they unblock
both the listing and `docs/privacy-policy-draft.md`. Name the grievance officer in the same
pass.

---

## B. Product rulings — no launch block, but they change what a user sees

### B1. Where the 1,200 floor binds intraday — the one worth reading carefully

`src/journal/compose.ts:10-13`, `app/index.tsx:268`, `src/components/SummaryCard.tsx:74`

Code today: the **Summary card** shows `flooredNetKcal` = `max(net, 1200)`. The **journal
header** shows the raw running total, which can read below 1,200 — matching spec/02's own
mock ("790 cals").

This looks like it contradicts non-negotiable #4 ("Net calories never display below 1,200"),
and it is the only place in the app where a number below the floor appears. But flooring the
header produces something worse than a rule violation: at 300 kcal logged by 11am, the header
would read **1,200** — a number the user did not eat. A partial sum floored is not a safety
floor, it is a wrong number.

The distinction that resolves it: the floor is a property of a **day-net evaluation** — "here
is where your day stands against your goal" — which is the Summary card, Stats, and History.
The header is a **running sum of what you logged so far**, and a sum should equal its parts.

**Recommendation:** keep the split as built, and record it in `MASTER.md` as a decision
rather than a gap, phrased as: _net-evaluation surfaces floor at 1,200; the intraday running
sum is a sum and is never floored, because a floored partial sum shows food the user did not
eat._ Then the flag comes out of `compose.ts`.
Alternative if you disagree: `app/index.tsx:268` swaps `netKcal` → `flooredNetKcal`, one word.

### B2. Decoction coffee — which milk

`src/engine/kitchen.ts:45-49`

Code today: `toned` (the schema default) at 100ml. spec/06 says "assume 100ml milk unless
specified" and never names the type. Whole vs toned is ~15 kcal on a filter coffee, ~60/day
for a four-cup drinker.

**Recommendation:** keep `toned`. It is the schema default, it is what most urban Indian
households buy, and the kitchen screen lets anyone who differs say so. Under-stating milk
also errs in the honest direction for a number we did not ask about.

### B3. `12 surya namaskar` — rounds → minutes

`supabase/seed/exercises.draft.json`

Code today: qty is treated as **minutes**, so "12 surya namaskar" bills 12 minutes at MET 2.7.
Users do log by rounds. One slow round is roughly a minute, so the current behaviour is
accidentally close — but only accidentally.

**Recommendation:** keep 1 round ≈ 1 minute and say so on the exercise teach sheet. A
rounds-aware unit means a new unit in the resolver contract for one exercise; not worth it
before there is usage data. Bounded error either way, and the conservative MET already guards
the exercise-as-allowance loop.

### B4. Stats windows — trailing vs calendar

`src/stats/aggregate.ts:17-22`

Code today: trailing 7 / 30 / 365 days ending today. spec/02 §E names the segments but not
the arithmetic.

**Recommendation:** keep trailing. "Week" always renders seven bars, so the chart never has a
ragged left edge on a Monday, and a trailing average is the honest read of "how am I doing
lately". Calendar weeks would also make Monday's chart a single bar — the worst day to look
at your own trend.

### B5. `i weigh 150` with no unit

`src/resolver/localRules.ts:26-29`

Code today: unitless first-person mass is read as **kg**, bounded 30–250.

**Recommendation:** keep kg. Canonical storage is kg (MASTER), the audience weighs in kg, and
the 30–250 bound already rejects the lbs reading of a heavy number (150 lbs = 68 kg is inside
the band, so the risk is real but small and the confirm-over-5kg guard catches the damage).
If you want it airtight, the alternative is to refuse a unitless mass and ask — one extra tap
on a line users type once a week.

### B6. The "Rate Slate" row colour

`app/settings/index.tsx:13-14`

Code today: the single indigo accent. spec/07 calls the row green; spec/03 reserves one accent
and the palette has no green.

**Recommendation:** keep the accent. Adding a second accent colour for one settings row is
how palettes rot. spec/07's "green" reads like shorthand for "make it look tappable".

### B7. Export — three files or one zip

`app/settings/export.tsx:2-3`

Code today: three explicit files (JSON + two CSVs) through the share sheet. A single bundle
needs a zip dependency.

**Recommendation:** keep three files. DPDP requires the data be portable, not archived, and
three named files are more legible to a user than an archive they have to unzip on a phone.

### B8. Kitchen calibration behind Plus — MASTER's own contested item

`MASTER.md` §Monetization

Implemented as instructed and still flagged there: calibration is the _accuracy of the free
tier's numbers_, not a capability. An uncalibrated free user gets numbers as wrong as every
competitor's — and writes that review.

**Recommendation:** move the four kitchen questions to free and keep _saved foods, custom
dishes, stats, photo, chat, Health, full history_ as Plus. Plus should sell more capability,
not less wrongness. This is one boolean in the settings gate.

---

## C. Numbers to bless (security review asked for these in Phase 2)

`supabase/migrations/20260710000003_resolver_hardening.sql`, `...0004_resolver_budget_fix.sql`

| Limit                | Value today            | Note                                                                               |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| Per-user rate limit  | 30 calls/min           | A human typing a journal cannot exceed this; a script can.                         |
| Global daily ceiling | 50,000 model calls/day | Spend ceiling, not a product limit. At Haiku prices this is a small daily maximum. |
| Cache key length     | 64 chars               | Longer lines skip the cache rather than fill it.                                   |
| Cache row budget     | 500,000 rows           | Reaper trims past this.                                                            |
| Budget pooling       | one shared pool        | Free and Plus draw from the same 50k.                                              |

**Recommendation:** bless all five as launch numbers and revisit after a week of real traffic
— they are all one migration to change. The only one worth thinking about now is pooling: a
shared pool means free-tier abuse can starve paying users. A separate, higher Plus pool is
the fix, and it is worth doing **before** the first paid week, not after.

Two smaller data assumptions, same class:

- `scripts/ifct/supplemental.json` — dahi is whole-milk (home dahi from toned would be ~58
  kcal/100g). Recommendation: keep whole-milk; it is the shop default.
- `scripts/ifct/ref-map.json` — variant picks (banana cultivar, carrot colour) are one-word
  reversals. Recommendation: leave as mapped; the chicken-cut ruling on 13 Jul was the only
  one that moved a dish materially.

---

## D. Not rulings — stubs that need their own spec

These carry `FLAG(nirmal)` but no decision would close them; they need a spec and a native
build, and all four are hidden from navigation today.

- `app/chat.tsx` — unspecified beyond "Plus". spec/06's warning still stands: **if Chat ships
  without consuming sleep, cut the sleep intent** rather than let it imply a relationship that
  doesn't exist.
- `app/settings/widget.tsx` — WidgetKit target + shared app group not created.
- `app/settings/apple-health.tsx` — HealthKit capability + read scopes not declared.
- `app/scanner.tsx` — label OCR needs a native Vision/MLKit module, unavailable in Expo Go.

**Recommendation:** leave all four hidden. The paywall already sells only what exists
(`cb5a142`), so nothing here is promised to a paying user.
