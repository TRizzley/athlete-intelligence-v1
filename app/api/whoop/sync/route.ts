// POST /api/whoop/sync
// Manual sync for the signed-in athlete: fetches the last N days of WHOOP data
// and upserts into daily_checkins. The athlete is always taken from the
// session — never from the request body. The pipeline lives in
// lib/whoop/sync-service.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidWhoopToken, syncWhoop, type WhoopTokenRow } from "@/lib/whoop";

const SYNC_DAYS = 30;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: tokenRow, error: tokenErr } = await admin
    .from("whoop_tokens")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle<WhoopTokenRow>();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: "whoop_not_connected" }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidWhoopToken(tokenRow, admin);
  } catch (err) {
    console.error("WHOOP token refresh failed", err);
    return NextResponse.json({ error: "token_refresh_failed" }, { status: 500 });
  }

  const result = await syncWhoop(user.id, accessToken, {
    daysBack: SYNC_DAYS,
    admin,
  });

  // Nothing synced and the fetch itself failed → surface it as a gateway error.
  if (!result.success && result.itemsSynced === 0) {
    return NextResponse.json(
      { error: "whoop_fetch_failed", details: result.errors },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    synced: result.itemsSynced,
    errors: result.errors,
    days_back: SYNC_DAYS,
  });
}
