import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exponentialBackoff,
  isTransientError,
  withRetry,
  buildSleepByDate,
  buildStrainByDate,
  transformWhoopData,
  syncWhoop,
} from "../sync-service";
import {
  WhoopApiError,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  fetchWhoopCycles,
  type WhoopRecovery,
  type WhoopSleep,
  type WhoopCycle,
} from "../client";

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return {
    ...actual,
    fetchWhoopRecoveries: vi.fn(),
    fetchWhoopSleeps: vi.fn(),
    fetchWhoopCycles: vi.fn(),
  };
});

const mockRecoveries = vi.mocked(fetchWhoopRecoveries);
const mockSleeps = vi.mocked(fetchWhoopSleeps);
const mockCycles = vi.mocked(fetchWhoopCycles);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function recovery(overrides: Partial<WhoopRecovery["score"]> = {}): WhoopRecovery {
  return {
    cycle_id: 1,
    sleep_id: 1,
    user_id: 42,
    created_at: "2026-07-01T09:00:00.000Z",
    updated_at: "2026-07-01T09:00:00.000Z",
    score_state: "SCORED",
    score: {
      user_calibrating: false,
      recovery_score: 71.6,
      resting_heart_rate: 51.4,
      hrv_rmssd_milli: 67.43,
      spo2_percentage: 96.5,
      skin_temp_celsius: 33.2,
      ...overrides,
    },
  };
}

function whoopSleep(efficiency: number | null): WhoopSleep {
  return {
    id: 1,
    user_id: 42,
    created_at: "2026-07-01T07:00:00.000Z",
    updated_at: "2026-07-01T07:00:00.000Z",
    start: "2026-06-30T23:00:00.000Z",
    end: "2026-07-01T07:00:00.000Z",
    timezone_offset: "-04:00",
    nap: false,
    score_state: "SCORED",
    score: {
      stage_summary: {
        total_in_bed_time_milli: 8 * 3_600_000,
        total_awake_time_milli: 30 * 60_000,
        total_no_data_time_milli: 0,
        total_light_sleep_time_milli: 4 * 3_600_000,
        total_slow_wave_sleep_time_milli: 1.5 * 3_600_000,
        total_rem_sleep_time_milli: 2 * 3_600_000,
        sleep_cycle_count: 5,
        disturbance_count: 3,
      },
      sleep_needed: {
        baseline_milli: 8 * 3_600_000,
        need_from_sleep_debt_milli: 0,
        need_from_recent_strain_milli: 0,
        need_from_recent_nap_milli: 0,
      },
      respiratory_rate: 15.2,
      sleep_performance_percentage: 90,
      sleep_consistency_percentage: 80,
      sleep_efficiency_percentage: efficiency as number,
    },
  };
}

function cycle(strain: number): WhoopCycle {
  return {
    id: 1,
    user_id: 42,
    created_at: "2026-07-01T04:00:00.000Z",
    updated_at: "2026-07-01T04:00:00.000Z",
    start: "2026-07-01T04:00:00.000Z",
    end: null,
    timezone_offset: "-04:00",
    score_state: "SCORED",
    score: { strain, kilojoule: 8000, average_heart_rate: 70, max_heart_rate: 160 },
  };
}

/** Minimal admin-client stand-in that records upsert calls. */
function fakeAdmin(upsertError: { message: string } | null = null) {
  const upserts: { row: Record<string, unknown>; options: unknown }[] = [];
  const admin = {
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, options: unknown) => {
        expect(table).toBe("daily_checkins");
        upserts.push({ row, options });
        return { error: upsertError };
      },
    }),
  };
  return { admin: admin as never, upserts };
}

const instantSleep = () => Promise.resolve();

beforeEach(() => {
  mockRecoveries.mockReset();
  mockSleeps.mockReset();
  mockCycles.mockReset();
});

// ── exponentialBackoff ───────────────────────────────────────────────────────

describe("exponentialBackoff", () => {
  it("stays within [1s, base+1s] for the first attempt", () => {
    for (let i = 0; i < 50; i++) {
      const ms = exponentialBackoff(0);
      expect(ms).toBeGreaterThanOrEqual(1000);
      expect(ms).toBeLessThanOrEqual(2000);
    }
  });

  it("caps at 30s plus jitter for large attempt numbers", () => {
    for (let i = 0; i < 50; i++) {
      const ms = exponentialBackoff(10);
      expect(ms).toBeGreaterThanOrEqual(29000);
      expect(ms).toBeLessThanOrEqual(31000);
    }
  });
});

// ── isTransientError ─────────────────────────────────────────────────────────

describe("isTransientError", () => {
  it("treats 429 and 5xx WHOOP responses as transient", () => {
    expect(isTransientError(new WhoopApiError("rate limited", 429))).toBe(true);
    expect(isTransientError(new WhoopApiError("server error", 500))).toBe(true);
    expect(isTransientError(new WhoopApiError("bad gateway", 502))).toBe(true);
  });

  it("treats auth and client errors as terminal", () => {
    expect(isTransientError(new WhoopApiError("unauthorized", 401))).toBe(false);
    expect(isTransientError(new WhoopApiError("forbidden", 403))).toBe(false);
    expect(isTransientError(new WhoopApiError("not found", 404))).toBe(false);
  });

  it("treats network-level failures as transient", () => {
    expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isTransientError(new Error("socket hang up"))).toBe(true);
    // undici wraps DNS/socket errors as TypeError("fetch failed") with a cause
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
    expect(
      isTransientError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })),
    ).toBe(true);
  });

  it("treats everything else as terminal", () => {
    expect(isTransientError(new Error("validation failed"))).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError("boom")).toBe(false);
  });
});

// ── withRetry ────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns the result after transient failures within the attempt budget", async () => {
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new WhoopApiError("flaky", 503))
      .mockRejectedValueOnce(new WhoopApiError("flaky", 503))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, {
      maxRetries: 3,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
  });

  it("rethrows terminal errors immediately without retrying", async () => {
    const fn = vi.fn().mockRejectedValue(new WhoopApiError("unauthorized", 401));
    const sleepFn = vi.fn();

    await expect(withRetry(fn, { maxRetries: 3, sleepFn })).rejects.toThrow("unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("rethrows the last transient error once attempts are exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new WhoopApiError("still down", 500));
    const sleepFn = vi.fn();

    await expect(withRetry(fn, { maxRetries: 3, sleepFn })).rejects.toThrow("still down");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2); // no sleep after the final attempt
  });
});

// ── transformWhoopData ───────────────────────────────────────────────────────

describe("transformWhoopData", () => {
  it("rounds hrv_ms to a true integer (int4 column)", () => {
    const row = transformWhoopData(recovery({ hrv_rmssd_milli: 67.43 }), "2026-07-01");
    expect(row?.hrv_ms).toBe(67);
    expect(Number.isInteger(row?.hrv_ms)).toBe(true);
  });

  it("rounds recovery_score and resting_hr to integers", () => {
    const row = transformWhoopData(recovery(), "2026-07-01");
    expect(row?.recovery_score).toBe(72);
    expect(row?.resting_hr).toBe(51);
  });

  it("clamps sleep_quality to a minimum of 1 (check constraint is 1-10)", () => {
    const sleeps = buildSleepByDate([whoopSleep(3)]); // 3% efficiency used to round to 0
    const row = transformWhoopData(recovery(), "2026-07-01", sleeps.get("2026-07-01"));
    expect(row?.sleep_quality).toBe(1);
  });

  it("clamps sleep_quality to a maximum of 10", () => {
    const sleeps = buildSleepByDate([whoopSleep(100)]);
    const row = transformWhoopData(recovery(), "2026-07-01", sleeps.get("2026-07-01"));
    expect(row?.sleep_quality).toBe(10);
  });

  it("maps ordinary efficiency onto the 1-10 scale", () => {
    const sleeps = buildSleepByDate([whoopSleep(87)]);
    const row = transformWhoopData(recovery(), "2026-07-01", sleeps.get("2026-07-01"));
    expect(row?.sleep_quality).toBe(9);
  });

  it("omits sleep_quality when efficiency is absent — never fabricates a value", () => {
    const sleeps = buildSleepByDate([whoopSleep(null)]);
    const row = transformWhoopData(recovery(), "2026-07-01", sleeps.get("2026-07-01"));
    expect(row).not.toHaveProperty("sleep_quality");
    expect(row?.sleep_hours).toBe(7.5); // 4h light + 1.5h SWS + 2h REM
  });

  it("omits all sleep fields when there is no sleep for the date", () => {
    const row = transformWhoopData(recovery(), "2026-07-01");
    expect(row).not.toHaveProperty("sleep_hours");
    expect(row).not.toHaveProperty("sleep_quality");
  });

  it("returns null for unscored recoveries", () => {
    const rec = { ...recovery(), score_state: "PENDING_SLEEP", score: null };
    expect(transformWhoopData(rec, "2026-07-01")).toBeNull();
  });
});

// ── buildSleepByDate / buildStrainByDate ─────────────────────────────────────

describe("buildSleepByDate", () => {
  it("skips naps and unscored sleeps", () => {
    const nap = { ...whoopSleep(90), nap: true };
    const unscored = { ...whoopSleep(90), score_state: "PENDING", score: null };
    expect(buildSleepByDate([nap, unscored]).size).toBe(0);
  });
});

describe("buildStrainByDate", () => {
  it("keys strain (1 decimal) by cycle start date", () => {
    const byDate = buildStrainByDate([cycle(14.5678)]);
    expect(byDate.get("2026-07-01")).toBe(14.6);
  });
});

// ── syncWhoop ────────────────────────────────────────────────────────────────

describe("syncWhoop", () => {
  it("upserts transformed rows keyed on user_id,checkin_date", async () => {
    mockRecoveries.mockResolvedValue([recovery()]);
    mockSleeps.mockResolvedValue([whoopSleep(87)]);
    mockCycles.mockResolvedValue([cycle(14.5678)]);
    const { admin, upserts } = fakeAdmin();

    const result = await syncWhoop("athlete-1", "token", { admin, sleepFn: instantSleep });

    expect(result).toEqual({ success: true, itemsSynced: 1, errors: [] });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row).toMatchObject({
      user_id: "athlete-1",
      checkin_date: "2026-07-01",
      hrv_ms: 67,
      sleep_quality: 9,
      whoop_strain: 14.6,
    });
    expect(upserts[0].options).toMatchObject({ onConflict: "user_id,checkin_date" });
  });

  it("retries transient fetch failures and succeeds", async () => {
    mockRecoveries
      .mockRejectedValueOnce(new WhoopApiError("flaky", 503))
      .mockResolvedValue([recovery()]);
    mockSleeps.mockResolvedValue([]);
    mockCycles.mockResolvedValue([]);
    const { admin } = fakeAdmin();

    const result = await syncWhoop("athlete-1", "token", { admin, sleepFn: instantSleep });

    expect(result.success).toBe(true);
    expect(result.itemsSynced).toBe(1);
    expect(mockRecoveries).toHaveBeenCalledTimes(2);
  });

  it("fails without retrying on terminal (auth) errors", async () => {
    mockRecoveries.mockRejectedValue(new WhoopApiError("unauthorized", 401));
    mockSleeps.mockResolvedValue([]);
    mockCycles.mockResolvedValue([]);
    const { admin } = fakeAdmin();

    const result = await syncWhoop("athlete-1", "token", { admin, sleepFn: instantSleep });

    expect(result.success).toBe(false);
    expect(result.itemsSynced).toBe(0);
    expect(result.errors[0]).toContain("terminal error, no retry");
    expect(mockRecoveries).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries on persistent transient errors", async () => {
    mockRecoveries.mockRejectedValue(new WhoopApiError("down", 500));
    mockSleeps.mockResolvedValue([]);
    mockCycles.mockResolvedValue([]);
    const { admin } = fakeAdmin();

    const result = await syncWhoop("athlete-1", "token", {
      admin,
      maxRetries: 3,
      sleepFn: instantSleep,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("exhausted 3 attempts");
    expect(mockRecoveries).toHaveBeenCalledTimes(3);
  });

  it("collects per-row upsert errors instead of failing silently", async () => {
    mockRecoveries.mockResolvedValue([recovery()]);
    mockSleeps.mockResolvedValue([]);
    mockCycles.mockResolvedValue([]);
    const { admin } = fakeAdmin({ message: "constraint violation" });

    const result = await syncWhoop("athlete-1", "token", { admin, sleepFn: instantSleep });

    expect(result.success).toBe(false);
    expect(result.itemsSynced).toBe(0);
    expect(result.errors[0]).toContain("Upsert failed for 2026-07-01");
    expect(result.errors[0]).toContain("constraint violation");
  });

  it("skips unscored recoveries without writing anything", async () => {
    mockRecoveries.mockResolvedValue([
      { ...recovery(), score_state: "PENDING_SLEEP", score: null },
    ]);
    mockSleeps.mockResolvedValue([]);
    mockCycles.mockResolvedValue([]);
    const { admin, upserts } = fakeAdmin();

    const result = await syncWhoop("athlete-1", "token", { admin, sleepFn: instantSleep });

    expect(result).toEqual({ success: true, itemsSynced: 0, errors: [] });
    expect(upserts).toHaveLength(0);
  });
});
