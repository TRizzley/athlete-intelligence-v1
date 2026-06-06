# Supabase setup — step by step

This app needs a Supabase project. Free tier is fine for a 20–30 person beta.

## 1. Create the project
1. [supabase.com](https://supabase.com) → sign in → **New project**.
2. Name it, set a database password (save it), pick a region close to you.
3. Wait ~2 minutes for provisioning.

## 2. Run the schema
1. Left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repo, copy **everything**, paste, **Run**.
3. You should see "Success. No rows returned." This created:
   - 10 tables under the `public` schema
   - the `is_admin()` helper + the `handle_new_user()` signup trigger
   - row-level-security policies on every table
   - a private **`screenshots`** storage bucket + its access policies

## 3. Get your API keys
**Project Settings** (gear icon) → **API**:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **Project API keys → `anon` `public`** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Project API keys → `service_role`** → `SUPABASE_SERVICE_ROLE_KEY` (secret)

Put these in `.env.local` (copy from `.env.example`).

## 4. Email confirmation (recommended: OFF for the beta)
**Authentication → Providers → Email** → toggle **Confirm email** OFF → Save.
With it off, participants can sign up and immediately use the app. With it on,
each participant must click a confirmation link in their email before logging in.

## 5. Become the coach (admin)
1. Run the app (`npm run dev`) and **sign up** with your coach email.
2. **SQL Editor** → run, replacing the email:
   ```sql
   update public.users set role = 'admin' where email = 'you@example.com';
   ```
3. Sign out / refresh. You now have the **Coach Console** at `/admin`.

---

## How security works (so you can trust it)
- **Row-Level Security is on for every table.** Participants can only read/write
  their own rows. Admins (role = `admin`) can read everyone.
- **Coaching responses are hidden until sent.** A participant only sees a
  response whose `status = 'sent'`. Drafts are coach-only.
- **Memory notes and trust metrics are coach-only** — participants can't read them.
- **Screenshots** live in a private bucket. Files are stored under
  `screenshots/{user_id}/…`, and the storage policies only let a user reach their
  own folder (admins can reach all). The app serves them via short-lived signed URLs.

## Troubleshooting
- **"new row violates row-level security policy"** when writing a coach response →
  your account isn't an admin yet. Re-run step 5.
- **Screenshots won't upload** → confirm the `screenshots` bucket exists
  (Storage tab) and that you ran the full `schema.sql` (it creates the bucket +
  policies).
- **Signup succeeds but no `public.users` row** → the `on_auth_user_created`
  trigger didn't run; re-run `schema.sql`.
- **Can log in but stuck on onboarding** → that's expected until you complete the
  athlete profile once.
