# The Coach — Sprint V1 Validation

A lightweight **concierge / wizard-of-oz validation tool** for the adaptive
performance coach. This is **not** the full product. Per *Task 8.75 — Founder
Review & Engineering Readiness Assessment*, the one assumption the company rests
on is untested: that a daily coaching decision can be specific and trustworthy
enough that a real stranger says *"damn, it gets me"* — and pays to keep it.

This app exists to test exactly that, by hand, in four weeks, with ~20–30
athletes — before committing to a year of engineering.

**What it does**

- Participants log a daily check-in and upload screenshots from their wearables.
- You (the coach/admin) read each athlete's data and **hand-write** the daily
  coaching response. There is **no AI engine, no ML, no wearable API** — that's
  deliberate and out of scope for this sprint.
- The system measures the aha: per-response feedback (accurate / personalized /
  useful / prediction-came-true / would-pay), prediction accuracy, and simple
  per-athlete trust metrics.

---

## Tech stack

- **Next.js** (App Router) + **TypeScript**
- **Supabase** — Postgres, Auth, Storage
- **Tailwind CSS** — mobile-first, dark, premium

---

## Setup (≈15 minutes)

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com) → **New project**. Wait for it to
provision. Then open **Project Settings → API** and copy:
- Project URL
- `anon` public key
- `service_role` key (keep secret)

### 2. Create the database schema
In the Supabase dashboard → **SQL Editor → New query**, paste the entire
contents of [`supabase/schema.sql`](supabase/schema.sql) and **Run**. This
creates all 10 tables, row-level-security policies, the signup trigger, and the
private `screenshots` storage bucket. It is safe to re-run.

### 3. Turn off email confirmation (recommended for the beta)
**Authentication → Providers → Email** → turn **"Confirm email" OFF**. This lets
beta participants sign up and start immediately. (You can leave it on, but then
each participant must click an email link before logging in.)

### 4. Configure environment variables
Copy `.env.example` to `.env.local` and fill in your three values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 5. Install and run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### 6. Make yourself the coach (admin)
1. Sign up in the app with the email you want to be the coach.
2. In the Supabase **SQL Editor**, run [`supabase/seed-admin.sql`](supabase/seed-admin.sql)
   after replacing the email with yours.
3. Refresh — you'll now see the **Coach Console** at `/admin`.

---

## How the daily loop works

**Participant**
1. `/signup` → `/onboarding` (athlete profile, one time)
2. `/checkin` — 60-second morning check-in
3. `/upload` — drop in WHOOP / Oura / Garmin / Apple / nutrition screenshots
4. `/dashboard` — see today's status and your latest coaching decision
5. `/coach/[id]` — read the decision → `/feedback/[id]` — rate it

**Coach (you)**
1. `/admin` — cohort overview + the trust signals that matter
2. `/admin/users/[id]` — read the athlete's latest check-in, screenshots, and
   memory; **write the daily decision**; log predictions, record outcomes, add
   memory notes, and watch their trust metrics.

---

## Pages

| Route | Who | Purpose |
|---|---|---|
| `/` | public | Landing |
| `/signup`, `/login` | public | Auth |
| `/onboarding` | participant | Athlete profile |
| `/checkin` | participant | Daily check-in |
| `/upload` | participant | Screenshot upload |
| `/dashboard` | participant | Home / today |
| `/coach`, `/coach/[id]` | participant | Read coaching responses |
| `/feedback/[id]` | participant | Rate a response |
| `/admin` | coach | Cohort dashboard |
| `/admin/users/[id]` | coach | Per-athlete review + compose |

---

## Database tables

`users`, `athlete_profiles`, `daily_checkins`, `uploaded_screenshots`,
`coach_responses`, `predictions`, `prediction_outcomes`, `user_feedback`,
`athlete_memory_notes`, `trust_metrics`. See
[`supabase/schema.sql`](supabase/schema.sql) for the full definitions and RLS.

---

## Scope guardrails (from Task 8.75)

**Intentionally NOT built:** the AI coach engine, wearable API integrations,
ML / automatic pattern recognition, and prediction engines. The coaching is
delivered by a human, by hand. The point is to learn whether the *decision*
lands — not to build the machine that makes it. If the aha proves out, build
with conviction. If it doesn't, you saved a year.

> Not a medical device. Not medical advice.
