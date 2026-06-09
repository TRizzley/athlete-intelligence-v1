# Deploy & update runbook

The single most important thing to remember: **there are two separate copies of this app.**

| | Where it runs | What it reads | Who sees it |
|---|---|---|---|
| **Local dev** | Your computer, `npm run dev` | Your local files, live as you edit | Only you, at `http://localhost:3000` |
| **Production** | Vercel | The `main` branch on GitHub (`TRizzley/athlete-intelligence-v1`) | Everyone — your phone, beta users, `athlete-intelligence-v1.vercel.app` |

Editing files on your computer changes **local dev only**. The phone / public site does **not** update until you push to GitHub, because Vercel rebuilds from GitHub — not from your computer.

---

## To see a change on your computer (local dev)

```powershell
cd "C:\Users\tyler\Claude\The Operating System for Human Performance\Phase 1\web"
npm run dev
```

If a change isn't showing, the build cache is stale. Stop the server (Ctrl+C) and:

```powershell
Remove-Item -Recurse -Force .next
npm run dev
```

Then hard-refresh the browser: **Ctrl+Shift+R**. (Note: PowerShell uses `Remove-Item`, not `rmdir /s /q`.)

---

## To push a change live (phone / production)

Run these one at a time:

```powershell
cd "C:\Users\tyler\Claude\The Operating System for Human Performance\Phase 1\web"
```
```powershell
git status
```
```powershell
git add -A
```
```powershell
git commit -m "describe what changed"
```
```powershell
git push
```

**Don't skip the commit.** `git add` only stages files; if you push without committing, you'll see "Everything up-to-date" and nothing deploys. A successful push prints `main -> main`.

After the push, Vercel builds for ~1–2 minutes. Watch vercel.com → your project → Deployments for **"Ready,"** then refresh the phone.

If the Vercel build **fails**, open that deployment's log, copy the error, and fix it — Vercel type-checks on every deploy, so a TypeScript/lint error blocks the release (local dev is more forgiving, so an error can be invisible locally but break the deploy).

---

## Gotchas we've hit

- **Tested a fix and it "still didn't work"?** Check *where* you're testing. A fix that's only on your computer won't appear on the phone/public site until it's pushed and deployed.
- The `.next` folder is a build cache. Deleting it forces a clean rebuild and fixes most "my change isn't showing" problems locally.
- CRLF/LF warnings on `git add` are harmless on Windows — ignore them.
- **The coach chat / daily decisions work locally but not in production?** This is almost always the `SUPABASE_SERVICE_ROLE_KEY` in Vercel being missing or *wrong*. Anything the server writes on your behalf (coach replies, daily decisions) uses the service-role "admin" client, which needs that exact key. If your own actions (saving a check-in, sending a message) work but the coach never responds, the admin key is the suspect.
  - **How to confirm:** Supabase → Logs → API. A bad key shows your own requests as `201/200` but every admin request (`coach_messages` POST, `daily_checkins` GET, etc.) as **401**.
  - **Fix:** copy the `service_role` key from Supabase → Settings → API, paste it into Vercel → Settings → Environment Variables → `SUPABASE_SERVICE_ROLE_KEY` (no extra spaces/line breaks, and make sure it's the long `service_role` key, NOT the `anon` key), then redeploy.
  - Env-var changes in Vercel only apply after a **new deployment** — redeploy or push a commit.
