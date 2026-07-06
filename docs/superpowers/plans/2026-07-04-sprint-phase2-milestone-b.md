# Sprint Phase 2 — Milestone B: Workout-Type Patterns & Coaching Focus

**Date:** 2026-07-04
**Status:** B1 committed (fc7f73f) · B2 committed (6e77172) · B3 verified 2026-07-05, committed (8ceefdd)

## Goal

The coach learns per-workout-type patterns from the athlete's self-evals and
derives an explicit coaching focus from them: which workout type to lean into
(push) and which to ease off (pull back). The decision of what to emphasize
lives in deterministic, testable code; the LLM only voices it.

## The corrected design decision: group by WORKOUT TYPE, not calendar day

Patterns are grouped by the workout the athlete rated — normalized `day_name`,
with null/empty bucketed as "Ad-hoc" — never by calendar day-of-week. Athletes
do the same workout on different days, so calendar grouping would blur
distinct workout types into one meaningless average. As a guard, no calendar-day
language is allowed anywhere in rationale strings or rendered focus output
(asserted in tests against Monday–Sunday).

## The three pure functions (detect → focus → metrics)

All flat `lib/coach-*.ts`, zero Supabase calls, full JSDoc, never throw on
thin/empty input; fetching stays in `lib/context.ts`.

1. **`detectWorkoutPatterns(evals, today)`** (`lib/coach-patterns.ts`, B1) —
   groups self-evals by normalized workout type over a 30-day window and
   returns `{ byWorkoutType (label/avgRpe/count/trend), peakTypes,
   struggleTypes, recommendations, windowDays }`.
2. **`derivePatternFocus(patterns)`** (`lib/coach-focus.ts`, B2) — turns the
   patterns into a deterministic directive
   `{ push_type, pull_back_type, rationale[], confidence }`, rendered as the
   SUGGESTED FOCUS block in `buildContextText()` right after WORKOUT
   PATTERNS, gated on having at least one non-null type.
3. **`summarizeFocusCoverage(perAthlete)`**
   (`lib/coach-focus-metrics.ts`, B3) — measures, over one derived focus per
   athlete, how much of the base gets an actionable directive:
   `{ total, withActionableFocus, highConfidence, pct_actionable,
   pct_high_confidence }`.

## Key decisions recorded

- **Min 2 evals per bucket** (`MIN_EVALS_PER_BUCKET`) — buckets below this are
  dropped: signal, not outliers. A single Ad-hoc eval therefore never forms a
  pattern.
- **30-day window on `workout_date`** (`PATTERN_WINDOW_DAYS`), inclusive;
  empty/unparseable dates are excluded (the `workout_date = ""` fallback from
  a null session join is guarded with `Number.isFinite`, never NaN-compared).
- **Peak ≥ 7, struggle ≤ 5 average RPE** (`PEAK_RPE`, `STRUGGLE_RPE`) —
  mutually exclusive by construction; `derivePatternFocus` asserts it and
  throws only on that impossible state.
- **Tie-break total order** so identical inputs in any order give identical
  output: highest avgRpe (lowest for pull_back), then trend — up > stable >
  down for push, down > stable > up for pull_back — then higher count, then
  alphabetical label.
- **Confidence = min of both chosen buckets**: 'high' only when every chosen
  bucket has count ≥ 3 (`FOCUS_CONFIDENCE_MIN_COUNT`), else 'low'; null when
  nothing was chosen. One thin bucket honestly downgrades the whole directive.
- **Ad-hoc bucketing**: null/empty `day_name` normalizes to the "ad-hoc" key
  with display label "Ad-hoc", treated like any other type.
- **Stable trend phrasing**: rationale reads "holding steady" (alongside
  "trending up"/"trending down") so every rationale line has the same shape.
- **No LLM arithmetic**: stats and the directive are pre-computed; the
  context block tells the model to voice the focus naturally, never quote it
  verbatim, and never mention calendar days.

## Verification (B3)

`lib/__tests__/coach-pipeline.test.ts` proves the real chain
(`summarizeSelfEvals` → `detectWorkoutPatterns` → `derivePatternFocus` →
`buildContextText`) composes over one fixed in-memory athlete: Leg day 7,8,9
(peak, trending up), Upper 1 5,5,4 (struggle, trending down), two unnamed
evals landing in Ad-hoc, one out-of-window eval excluded (count and average
unmoved). Focus resolves push "Leg day" / pull back "Upper 1" / confidence
'high', and the rendered context carries ATHLETE SELF-EVALS → WORKOUT
PATTERNS → SUGGESTED FOCUS in order with no calendar-day words. No DB, no
mocks — the actual pure functions.

## The dial: focus coverage

`summarizeFocusCoverage` is the validation metric for Milestone B: what share
of athletes the pipeline hands an actionable focus (`pct_actionable`) and how
much of that is high-confidence (`pct_high_confidence`). Percentages are
rounded to 1 decimal and division by zero is guarded (empty input → all
zeros, never NaN).

**It reads 0% today and that is expected** — `workout_self_evals` has 0 rows
in production. The unlock is the deferred post-workout eval UI form from
Milestone A (until it ships, evals require a signed-in POST). Getting evals
flowing is the next real-world priority; B3 built the dial, real usage moves
the needle.

## Test count at close

125 passing (9 test files) · `tsc --noEmit` clean.
