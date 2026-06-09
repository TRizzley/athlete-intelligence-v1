# SMS Check-in Reminders — Setup

The code is built. To turn on the daily reminder texts, do this once.

## 1. Create a Twilio account & number
1. Sign up at https://www.twilio.com/try-twilio (free trial includes credit).
2. In the Console, buy an **SMS-capable phone number** (Phone Numbers → Buy a number).
3. From the Console dashboard, copy your **Account SID** and **Auth Token**.

## 2. Add env vars in Vercel
Project → Settings → Environment Variables. Add (Production):

| Name | Value |
|------|-------|
| `TWILIO_ACCOUNT_SID` | your Account SID (starts `AC...`) |
| `TWILIO_AUTH_TOKEN` | your Auth Token |
| `TWILIO_FROM_NUMBER` | your Twilio number in E.164, e.g. `+15551234567` |
| `CRON_SECRET` | a long random string you make up (e.g. from a password generator) |
| `NEXT_PUBLIC_APP_URL` | your live app URL, e.g. `https://your-app.vercel.app` |

Then **redeploy** so the vars take effect.

## 3. The schedule
`vercel.json` already registers the cron: it runs **once daily at 17:00 UTC** (noon ET / 9am PT) and texts every athlete who has a phone on file but hasn't checked in yet that day. Change the `schedule` in `vercel.json` if you want a different time (it's a standard cron expression).

## How it behaves
- Only texts people **without** a check-in for the day, and **at most once per day** (tracked by `last_checkin_reminder_at`).
- Message: "Hey [name], quick reminder to log today's check-in with your coach: [link] (reply STOP to opt out)."
- If the Twilio vars aren't set, the job safely no-ops — nothing breaks.
- Twilio handles STOP/opt-out automatically on standard numbers.

## Test it
After setting the vars + redeploying, you can trigger it manually:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app.vercel.app/api/cron/checkin-reminders
```
It returns `{ ok: true, sent, skipped, errors }`.
