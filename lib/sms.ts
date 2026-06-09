// ----------------------------------------------------------------------------
// SMS sending via Twilio's REST API (no SDK — just fetch, so no extra dependency).
//
// Server-only. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER
// (an SMS-capable Twilio number in E.164, e.g. +15551234567). If any are missing,
// smsConfigured() is false and senders no-op safely.
// ----------------------------------------------------------------------------

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM_NUMBER;

export function smsConfigured(): boolean {
  return Boolean(SID && TOKEN && FROM);
}

export async function sendSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!smsConfigured()) return { ok: false, error: "SMS is not configured." };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: FROM as string, Body: body });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown SMS error",
    };
  }
}
