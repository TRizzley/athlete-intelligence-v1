// Public entry point for the WHOOP module. `@/lib/whoop` resolves here, so
// existing imports of the client helpers keep working unchanged.
//
// Note: refreshWhoopToken exported here is the non-destructive per-athlete
// refresher from sync-service (explicit re-export wins over the star export
// of client.ts's low-level refreshWhoopToken, which getValidWhoopToken uses
// internally).
export * from "./client";
export { syncWhoop, refreshWhoopToken, type SyncWhoopResult } from "./sync-service";
