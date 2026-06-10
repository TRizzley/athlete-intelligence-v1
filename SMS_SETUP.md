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
| `REMINDER_TIMEZONE` | (optional) IANA tz for the 9am/7pm timing; defaults to `America/New_York` |

Then **redeploy** so the vars take effect.

## 3. The schedule
`vercel.json` registers a reminder "tick" (`/api/cron/reminders`) that runs **every 15 minutes**. On each tick it sends, when due:
- **9am local** — morning check-in reminder, if no check-in logged today.
- **7pm local** — post-workout reminder, if no post-workout logged today.
- **~15 min after a coach response** — a nudge to give feedback, if none yet.

"Local" uses `REMINDER_TIMEZONE` (one app timezone for the beta).

> ⚠️ **Vercel plan:** a 15-minute cron requires **Vercel Pro**. On the Hobby plan, cron jobs only run **once per day**, so the 9am/7pm/feedback timing won't work. If you're on Hobby, tell Claude and we'll drive the tick from Supabase (pg_cron) instead — works on any plan.

## How it behaves
- Each reminder is sent **at most once per day per athlete** (tracked by `morning_reminder_date` / `postworkout_reminder_date`), and each feedback nudge **once per response** (`feedback_reminder_at`).
- Only texts people who haven't done the relevant thing yet.
- If the Twilio vars aren't set, the job safely no-ops — nothing breaks.
- Twilio handles STOP/opt-out automatically on standard numbers.

## Test it
After setting the vars + redeploying, you can trigger a tick manually:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app.vercel.app/api/cron/reminders
```
It returns `{ ok: true, localDate, hour, sent: { morning, postworkout, feedback }, errors }`. (It only sends morning/post-workout texts when the local hour is 9 or 19.)
