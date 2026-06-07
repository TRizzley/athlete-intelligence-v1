# How we ship changes to V1

A short, repeatable playbook so changes go out fast and safely. Keep this file
open whenever we're making changes.

## Who does what

- **Claude** edits the code, makes database changes (through the connected
  Supabase connection), and verifies the logic against live data.
- **You** run one deploy command and confirm the result in the browser.
- Claude can't build or deploy directly, so every change ends with you running
  the deploy.

## The loop (every change)

1. You tell Claude what you want changed.
2. Claude edits the code and/or updates the database, and says when it's ready.
3. You deploy (see below).
4. You hard-refresh the live page (**Ctrl + Shift + R**) and we confirm together.

## Deploying — one command

Open PowerShell in this folder (`web`) and run:

```powershell
.\deploy.ps1 "short note about what changed"
```

That installs dependencies, commits, and pushes. Vercel then builds and deploys
automatically (~1–2 min). Watch it at **vercel.com → athlete-intelligence-v1 →
Deployments**; when it says **Ready**, hard-refresh the site.

### Opening PowerShell in this folder
File Explorer → go to `...\Phase 1\web` → click the address bar, type
`powershell`, Enter. (Or Start menu → `powershell`, then
`cd "C:\Users\tyler\Claude\The Operating System for Human Performance\Phase 1\web"`.)

### One-time only
If you ever see *"running scripts is disabled on this system"*, run this once and
answer **Y**:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Environment variables (secrets)

Set in **Vercel → Settings → Environment Variables** (Production + Preview +
Development). After adding or changing one, **redeploy** for it to take effect.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | App ↔ database (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App ↔ database (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server writes for screenshot OCR + coach AI |
| `ANTHROPIC_API_KEY` | Screenshot OCR + "Generate Coach Response" |

## Database changes

Claude makes schema/data changes through the connected Supabase connection and
mirrors them into `supabase/schema.sql`. You don't need to run SQL by hand. If a
change ever needs to be applied manually, Claude will give you the exact SQL to
paste into Supabase → SQL Editor.

## If a deploy fails (Vercel shows "Error")

Open the failed deployment → scroll the build log to the red line → paste it to
Claude. Most failures are a missing dependency (fixed by `npm install`, which
`deploy.ps1` already runs) or a type error in a recently changed file.

## Quick checks

- See live check-in / upload data: ask Claude (reads the database directly).
- Confirm a deploy is live: the Deployments tab shows the latest commit message.
