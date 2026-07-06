// saveSession (B5.1) — the merged save: one call writes the session, the
// self-eval (A1 rules inline), and the daily_checkins training columns, with
// one RPE feeding both workout_self_evals.rpe and workout_intensity.
// Mirrors the mocking style of app/api/athlete/workouts/__tests__/eval.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveSession } from "../actions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/coach-trends", () => ({ refreshWorkoutDataStats: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const mockCreateClient = vi.mocked(createClient);
const mockRedirect = vi.mocked(redirect);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ATHLETE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ATHLETE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_DATE = "2026-07-06";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type SessionRow = {
  id: string;
  user_id: string;
  session_date: string;
  status: string | null;
} | null;

/**
 * Mock user-scoped client covering every query the merged saveSession makes:
 * the session ownership lookup + finalize update, set-log updates, the eval
 * upsert, and the check-in upsert. Records payloads for assertions.
 */
function mockDb({
  user = { id: ATHLETE_ID } as { id: string } | null,
  session = {
    id: SESSION_ID,
    user_id: ATHLETE_ID,
    session_date: SESSION_DATE,
    status: "pending",
  } as SessionRow,
  evalError = null as { message: string } | null,
  checkinError = null as { message: string } | null,
} = {}) {
  const writes = {
    setLogUpdates: [] as Record<string, unknown>[],
    sessionUpdate: null as Record<string, unknown> | null,
    evalUpserts: [] as [Record<string, unknown>, Record<string, unknown>][],
    checkinUpserts: [] as [Record<string, unknown>, Record<string, unknown>][],
  };

  const from = vi.fn((table: string) => {
    if (table === "workout_sessions") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: session, error: null }),
          }),
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          writes.sessionUpdate = payload;
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }),
      };
    }
    if (table === "workout_set_logs") {
      return {
        update: vi.fn((payload: Record<string, unknown>) => {
          writes.setLogUpdates.push(payload);
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }),
      };
    }
    if (table === "workout_self_evals") {
      return {
        upsert: vi.fn(
          (payload: Record<string, unknown>, opts: Record<string, unknown>) => {
            writes.evalUpserts.push([payload, opts]);
            return Promise.resolve({ error: evalError });
          },
        ),
      };
    }
    if (table === "daily_checkins") {
      return {
        upsert: vi.fn(
          (payload: Record<string, unknown>, opts: Record<string, unknown>) => {
            writes.checkinUpserts.push([payload, opts]);
            return Promise.resolve({ error: checkinError });
          },
        ),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from,
  };
  mockCreateClient.mockResolvedValue(supabase as unknown as SupabaseServerClient);
  return { from, writes };
}

/** FormData the SessionLogger posts. session_id included unless overridden. */
function fd(entries: Record<string, string | string[]> = {}): FormData {
  const f = new FormData();
  f.set("session_id", SESSION_ID);
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
}

const initial = { error: null };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("saveSession — merged post-workout capture", () => {
  it("writes session + eval + check-in columns in one save (happy path)", async () => {
    const { writes } = mockDb();

    await saveSession(
      initial,
      fd({
        log_ids: "l1,l2",
        weight_l1: "135",
        reps_l1: "8",
        weight_l2: "225",
        reps_l2: "5",
        notes: "solid session",
        rpe: "8",
        eval_feedback: "felt strong",
        workout_types: ["strength", "hypertrophy"],
        workout_split: "Leg day",
      }),
    );

    // Session finalized as before.
    expect(writes.sessionUpdate).toMatchObject({
      notes: "solid session",
      status: "completed",
    });
    expect(writes.setLogUpdates).toHaveLength(2);

    // Eval upsert with A1 semantics.
    expect(writes.evalUpserts).toHaveLength(1);
    expect(writes.evalUpserts[0][0]).toEqual({
      user_id: ATHLETE_ID,
      workout_id: SESSION_ID,
      rpe: 8,
      feedback: "felt strong",
    });
    expect(writes.evalUpserts[0][1]).toEqual({ onConflict: "workout_id" });

    // Check-in training columns — exactly what savePostWorkout wrote.
    expect(writes.checkinUpserts).toHaveLength(1);
    expect(writes.checkinUpserts[0][0]).toEqual({
      user_id: ATHLETE_ID,
      checkin_date: SESSION_DATE,
      workout_completed: true,
      workout_types: ["strength", "hypertrophy"],
      workout_type: "strength",
      workout_split: "Leg day",
      workout_intensity: 8,
      training_load: null,
      top_set_lbs: 225,
    });
    expect(writes.checkinUpserts[0][1]).toEqual({
      onConflict: "user_id,checkin_date",
    });
  });

  it("dual-writes ONE rpe to both workout_self_evals.rpe and workout_intensity", async () => {
    const { writes } = mockDb();

    await saveSession(initial, fd({ rpe: "6" }));

    expect(writes.evalUpserts[0][0].rpe).toBe(6);
    expect(writes.checkinUpserts[0][0].workout_intensity).toBe(6);
    expect(writes.evalUpserts[0][0].rpe).toBe(
      writes.checkinUpserts[0][0].workout_intensity,
    );
  });

  it("redirects to the coach chat on first completion only", async () => {
    mockDb();
    await saveSession(initial, fd({ rpe: "7" }));
    expect(mockRedirect).toHaveBeenCalledWith("/coach/chat?expect=review");
  });

  it("stays on the page (no redirect) when updating an already-completed session", async () => {
    const { writes } = mockDb({
      session: {
        id: SESSION_ID,
        user_id: ATHLETE_ID,
        session_date: SESSION_DATE,
        status: "completed",
      },
    });

    const result = await saveSession(initial, fd({ rpe: "7" }));

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toEqual({ error: null, ok: true });
    // The eval still upserts — latest submission wins (A1 semantics).
    expect(writes.evalUpserts).toHaveLength(1);
  });

  it.each(["0", "11", "7.5", "abc"])(
    "rejects invalid RPE %j before any read or write",
    async (rpe) => {
      const { from } = mockDb();

      const result = await saveSession(initial, fd({ rpe }));

      expect(result.error).toMatch(/RPE/);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing RPE (slider never tapped) before any read or write", async () => {
    const { from } = mockDb();

    const result = await saveSession(initial, fd());

    expect(result.error).toMatch(/RPE/);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects feedback over 200 characters before any read or write", async () => {
    const { from } = mockDb();

    const result = await saveSession(
      initial,
      fd({ rpe: "7", eval_feedback: "x".repeat(201) }),
    );

    expect(result.error).toMatch(/200/);
    expect(from).not.toHaveBeenCalled();
  });

  it("stores null feedback when the one-liner is blank", async () => {
    const { writes } = mockDb();

    await saveSession(initial, fd({ rpe: "7", eval_feedback: "   " }));

    expect(writes.evalUpserts[0][0].feedback).toBeNull();
  });

  it("fails with no writes when the session belongs to another athlete", async () => {
    const { writes } = mockDb({
      session: {
        id: SESSION_ID,
        user_id: OTHER_ATHLETE_ID,
        session_date: SESSION_DATE,
        status: "pending",
      },
    });

    const result = await saveSession(initial, fd({ rpe: "7" }));

    expect(result.error).toMatch(/not found/i);
    expect(writes.sessionUpdate).toBeNull();
    expect(writes.setLogUpdates).toHaveLength(0);
    expect(writes.evalUpserts).toHaveLength(0);
    expect(writes.checkinUpserts).toHaveLength(0);
  });

  it("fails with no writes when the session does not exist", async () => {
    const { writes } = mockDb({ session: null });

    const result = await saveSession(initial, fd({ rpe: "7" }));

    expect(result.error).toMatch(/not found/i);
    expect(writes.evalUpserts).toHaveLength(0);
    expect(writes.checkinUpserts).toHaveLength(0);
  });

  it("derives top_set_lbs from the heaviest logged weight when left blank", async () => {
    const { writes } = mockDb();

    await saveSession(
      initial,
      fd({
        rpe: "7",
        log_ids: "l1,l2,l3",
        weight_l1: "185",
        weight_l2: "225.5",
        weight_l3: "",
      }),
    );

    expect(writes.checkinUpserts[0][0].top_set_lbs).toBe(225.5);
  });

  it("lets an explicit top set win over the derived one", async () => {
    const { writes } = mockDb();

    await saveSession(
      initial,
      fd({ rpe: "7", top_set_lbs: "245", log_ids: "l1", weight_l1: "225" }),
    );

    expect(writes.checkinUpserts[0][0].top_set_lbs).toBe(245);
  });

  it("allows training_load and top_set to be null (no weights logged)", async () => {
    const { writes } = mockDb();

    await saveSession(initial, fd({ rpe: "7" }));

    expect(writes.checkinUpserts[0][0].training_load).toBeNull();
    expect(writes.checkinUpserts[0][0].top_set_lbs).toBeNull();
  });

  it("surfaces one error and stops when the eval write fails", async () => {
    const { writes } = mockDb({ evalError: { message: "boom" } });

    const result = await saveSession(initial, fd({ rpe: "7" }));

    expect(result.error).toMatch(/rating/i);
    // The check-in write never ran — re-pressing Save retries idempotently.
    expect(writes.checkinUpserts).toHaveLength(0);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
