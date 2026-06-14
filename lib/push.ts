// ----------------------------------------------------------------------------
// APNs (Apple Push Notification service) sender — dependency-free.
//
// Uses Node's built-in http2 + crypto, so there is NO new npm dependency and it
// must run on the Node.js runtime (not edge). Sends a single alert push to a
// device token via Apple's token-based (.p8 key) auth.
//
// ENV-GATED: if the APNs env vars below aren't set, sendPush() safely no-ops and
// returns { skipped: true } — nothing breaks. This mirrors the Twilio pattern:
// the feature turns on only once you add credentials (which require an ACTIVE
// Apple Developer account — see ios-native/README.md to create the .p8 key).
//
// Required env vars (set in Vercel, Production):
//   APNS_KEY_P8     -- the full contents of your AuthKey_XXXX.p8 (with headers),
//                      newlines preserved or escaped as \n
//   APNS_KEY_ID     -- the 10-char Key ID for that key
//   APNS_TEAM_ID    -- your 10-char Apple Developer Team ID
//   APNS_BUNDLE_ID  -- the app bundle id, e.g. com.sprintv1.app (apns-topic)
//   APNS_PRODUCTION -- "true" for the production gateway; anything else => sandbox
// ----------------------------------------------------------------------------

import http2 from "node:http2";
import { createSign } from "node:crypto";

type PushPayload = {
  title: string;
  body: string;
  /** Optional deep-link path the app can route to, surfaced in the payload. */
  path?: string;
};

type SendResult =
  | { ok: true; token: string }
  | { ok: false; token: string; status?: number; reason?: string }
  | { skipped: true };

function config() {
  const keyP8 = process.env.APNS_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!keyP8 || !keyId || !teamId || !bundleId) return null;
  return {
    keyP8: keyP8.replace(/\\n/g, "\n"),
    keyId,
    teamId,
    bundleId,
    host:
      process.env.APNS_PRODUCTION === "true"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com",
  };
}

// APNs JWTs are valid up to 60 min and Apple asks you to reuse them rather than
// minting one per push. Cache for 50 min.
let cachedToken: { jwt: string; madeAt: number } | null = null;

function bearerJwt(cfg: NonNullable<ReturnType<typeof config>>): string {
  const now = Date.now();
  if (cachedToken && now - cachedToken.madeAt < 50 * 60 * 1000) {
    return cachedToken.jwt;
  }
  const header = { alg: "ES256", kid: cfg.keyId };
  const claims = { iss: cfg.teamId, iat: Math.floor(now / 1000) };
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(claims)}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  // ES256 over P-256; ieee-p1363 is the JOSE-required signature encoding.
  const sig = signer
    .sign({ key: cfg.keyP8, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  const jwt = `${signingInput}.${sig}`;
  cachedToken = { jwt, madeAt: now };
  return jwt;
}

/** Send one push to one device token. No-ops (skipped) when APNs isn't configured. */
export async function sendPush(
  token: string,
  payload: PushPayload,
): Promise<SendResult> {
  const cfg = config();
  if (!cfg) return { skipped: true };

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
    },
    ...(payload.path ? { path: payload.path } : {}),
  });

  return new Promise<SendResult>((resolve) => {
    const client = http2.connect(cfg.host);
    let settled = false;
    const done = (r: SendResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(r);
    };

    client.on("error", (e) =>
      done({ ok: false, token, reason: (e as Error).message }),
    );

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      authorization: `bearer ${bearerJwt(cfg)}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });

    let status = 0;
    let data = "";
    req.on("response", (h) => {
      status = Number(h[":status"]) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (status === 200) return done({ ok: true, token });
      let reason: string | undefined;
      try {
        reason = JSON.parse(data)?.reason;
      } catch {
        /* non-JSON body */
      }
      done({ ok: false, token, status, reason });
    });
    req.on("error", (e) => done({ ok: false, token, reason: e.message }));

    req.write(body);
    req.end();
  });
}

/** True when APNs credentials are present (the reminder cron can actually send). */
export function pushConfigured(): boolean {
  return config() !== null;
}
