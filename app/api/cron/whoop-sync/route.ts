// GET /api/cron/whoop-sync
// Runs daily via Vercel Cron. Syncs last 7 days for all WHOOP users.
// The fetch → transform → upsert pipeline lives in lib/whoop/sync-service.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidWhoopToken, syncWhoop, type WhoopTokenRow } from "@/lib/whoop";

export const maxDuration = 60;

const SYNC_DAYS = 7;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: tokens, error } = await admin.from("whoop_tokens").select("*");

  if (error || !tokens) {
    return NextResponse.json({ error: "failed_to_load_tokens" }, { status: 500 });
  }

  const results: {
    user_id: string;
    synced: number;
    errors?: string[];
    error?: string;
  }[] = [];

  for (const tokenRow of tokens as WhoopTokenRow[]) {
    try {
      const accessToken = await getValidWhoopToken(tokenRow, admin);
      const result = await syncWhoop(tokenRow.user_id, accessToken, {
        daysBack: SYNC_DAYS,
        admin,
      });
      results.push({
        user_id: tokenRow.user_id,
        synced: result.itemsSynced,
        ...(result.errors.length > 0 ? { errors: result.errors } : {}),
      });
    } catch (err) {
      // Token refresh failed (row preserved) — skip this athlete this cycle.
      console.error(`WHOOP sync failed for user ${tokenRow.user_id}:`, err);
      results.push({ user_id: tokenRow.user_id, synced: 0, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
