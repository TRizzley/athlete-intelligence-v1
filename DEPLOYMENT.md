# Vercel Deployment Checklist — Sprint V1 Validation

This `web/` folder is a self-contained Next.js 15 app and is its own git repo, so
on Vercel the **Root Directory is `./`** — no monorepo configuration needed.

> ⚠️ Secrets never go in this file or any commit. Values for the variables below
> live only in your local `web/.env.local` (gitignored) and the Supabase dashboard.

---

## 0. Pre-flight — done locally ✅
- [x] `npm run build` passes with zero errors
- [x] Git initialized on branch `main` with an initial commit
- [x] `.gitignore` excludes `.env*.local`, `.env`, `/node_modules`, `/.next`, `next-env.d.ts`
- [x] `.env.local` is **not** tracked (verified) — Supabase secrets stay local

## 1. Push to GitHub
Create an **empty** repo at <https://github.com/new> (no README/.gitignore), then
from inside the `web/` folder:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## 2. Import into Vercel
1. <https://vercel.com> → **Add New… → Project** → import the GitHub repo.
2. **Framework Preset:** Next.js (auto-detected).
3. **Root Directory:** `./` (the repo root *is* the app — leave default).
4. **Build Command / Output:** defaults (`next build`).
5. **Do not deploy yet** — add the environment variables first (Step 3).

## 3. Environment variables
Vercel → Project → **Settings → Environment Variables**. Add each one with
**Production, Preview, and Development** all checked. Copy each value from your
local `web/.env.local` (or Supabase → **Project Settings → API**).

| Variable | Required? | Secret? | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Required | No (public) | Your project URL. **Inlined into the browser bundle at build time.** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Required | No (public) | Anon key; safe in the browser. **Inlined at build time.** |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Required | **YES** | Used by the background screenshot OCR to write parsed values into check-ins (`lib/supabase/admin.ts`). Never give it a `NEXT_PUBLIC_` prefix. |
| `ANTHROPIC_API_KEY` | ✅ Required | **YES** | Powers screenshot OCR (Claude vision reads Whoop/nutrition screenshots and auto-fills the day's check-in). Get one at <https://console.anthropic.com> → API Keys. Server-only — never `NEXT_PUBLIC_`. |
| `OCR_MODEL` | ⬜ Optional | No | Overrides the vision model (default `claude-sonnet-4-6`). |

> **New dependency:** the OCR feature uses the `@anthropic-ai/sdk` package. Run
> `npm install @anthropic-ai/sdk` locally and commit the updated `package.json` /
> `package-lock.json` before deploying.

> The two `NEXT_PUBLIC_*` values are baked in at **build time**, so they must be
> present in Vercel *before* the build runs. If you add/change them later, trigger
> a **Redeploy** for them to take effect.

## 4. Deploy
Click **Deploy**. First build is ~1–2 minutes.

## 5. Point Supabase at the live URL
Supabase → **Authentication → URL Configuration**:
- **Site URL:** your Vercel production URL (e.g. `https://<project>.vercel.app`)
- **Redirect URLs:** add the production URL plus a preview wildcard such as
  `https://*.vercel.app/**`

Also confirm **Authentication → Providers → Email → Confirm email = OFF** for the
beta. (Pure email/password with confirmation off doesn't strictly need redirect
URLs, but set them so password-reset/magic links and any future OAuth work.)

## 6. Smoke-test the deployment
- [ ] `/`, `/login`, `/signup` load over HTTPS
- [ ] Sign up a test athlete → `/onboarding` → `/checkin` → `/upload`
- [ ] Coach account (role = `admin`) sees the Console at `/admin`
- [ ] A screenshot uploads (private `screenshots` bucket + signed URLs work)

## 7. Security reminders
- The `service_role` key must **never** be public — keep it out of any
  `NEXT_PUBLIC_*` var, out of the repo, and out of screenshots.
- `.env.local` is gitignored; keep it that way. If a secret ever leaks, rotate it
  in Supabase (Settings → API → "Reset") and update Vercel + `.env.local`.
- Row-Level Security is on for every table; the service role bypasses it.

---

### Optional polish
- **Line endings:** this app was authored on Windows. To avoid CRLF/LF churn in a
  Linux-built repo, add a `.gitattributes` with `* text=auto eol=lf`.
- **Vercel CLI alternative:** instead of the GitHub flow you can run `npx vercel`
  from `web/` and follow the prompts; set the same env vars with
  `npx vercel env add <NAME>`.

> Not a medical device. Not medical advice.
