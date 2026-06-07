# deploy.ps1 - one-command deploy for the V1 app.
#
# Usage (from the web folder, in PowerShell):
#     .\deploy.ps1 "short description of what changed"
#
# It installs dependencies (keeps the lockfile in sync so Vercel won't fail),
# commits everything, and pushes to GitHub. Vercel then auto-deploys.
#
# One-time setup if you ever see "running scripts is disabled on this system":
#     Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# (answer Y). You only need to do that once, ever.

param(
  [Parameter(Mandatory = $true)]
  [string]$Message
)

$ErrorActionPreference = "Stop"

Write-Host "==> Installing dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed. Stopping."; exit 1 }

Write-Host "==> Staging changes..."
git add -A

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host "No changes to deploy."; exit 0 }

Write-Host "==> Committing..."
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Host "Commit failed. Stopping."; exit 1 }

Write-Host "==> Pushing to GitHub (Vercel will auto-deploy)..."
git push
if ($LASTEXITCODE -ne 0) { Write-Host "Push failed. Stopping."; exit 1 }

Write-Host ""
Write-Host "Done. Vercel is now building. Watch it at vercel.com -> Deployments."
Write-Host "When it says Ready, open /admin and hard-refresh with Ctrl+Shift+R."
