import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../[workoutId]/eval/route";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ATHLETE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ATHLETE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKOUT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Builds a mock user-scoped Supabase client covering the two queries the
 * route makes: the workout_sessions ownership lookup and the eval upsert.
 */
function mockSupabase({
  user = { id: ATHLETE_ID },
  workout = { id: WORKOUT_ID, user_id: ATHLETE_ID },
  upsertData = null,
}: {
  user?: { id: string } | null;
  workout?: { id: string; user_id: string } | null;
  upsertData?: Record<string, unknown> | null;
} = {}) {
  const upsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: upsertData ?? {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          user_id: user?.id,
          workout_id: WORKOUT_ID,
          rpe: 7,
          feedback: "felt strong",
        },
        error: null,
      }),
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === "workout_sessions") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: workout, error: null }),
          }),
        }),
      };
    }
    return { upsert };
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from,
  };

  mockCreateClient.mockResolvedValue(
    supabase as unknown as SupabaseServerClient,
  );
  return { supabase, upsert, from };
}

function callRoute(body: unknown, workoutId: string = WORKOUT_ID) {
  const request = new Request(
    `http://localhost/api/athlete/workouts/${workoutId}/eval`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return POST(request, { params: Promise.resolve({ workoutId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/athlete/workouts/:workoutId/eval", () => {
  it("saves a valid evaluation", async () => {
    const { upsert } = mockSupabase();

    const res = await callRoute({ rpe: 7, feedback: "felt strong" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.eval.rpe).toBe(7);
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: ATHLETE_ID,
        workout_id: WORKOUT_ID,
        rpe: 7,
        feedback: "felt strong",
      },
      { onConflict: "workout_id" },
    );
  });

  it("saves with feedback omitted (RPE only) and stores null", async () => {
    const { upsert } = mockSupabase();

    const res = await callRoute({ rpe: 4 });

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ rpe: 4, feedback: null }),
      { onConflict: "workout_id" },
    );
  });

  it.each([0, 11, 7.5, "7", null, undefined])(
    "rejects invalid RPE %j with 400",
    async (rpe) => {
      mockSupabase();

      const res = await callRoute({ rpe, feedback: "ok" });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/RPE/);
    },
  );

  it("rejects feedback over 200 characters with 400", async () => {
    mockSupabase();

    const res = await callRoute({ rpe: 5, feedback: "x".repeat(201) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/200/);
  });

  it("rejects non-string feedback with 400", async () => {
    mockSupabase();

    const res = await callRoute({ rpe: 5, feedback: 123 });

    expect(res.status).toBe(400);
  });

  it("rejects a malformed workoutId with 400 before hitting the database", async () => {
    const { from } = mockSupabase();

    const res = await callRoute({ rpe: 5 }, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 401 when not signed in", async () => {
    mockSupabase({ user: null });

    const res = await callRoute({ rpe: 5 });

    expect(res.status).toBe(401);
  });

  it("returns 404 when the workout does not exist", async () => {
    mockSupabase({ workout: null });

    const res = await callRoute({ rpe: 5 });

    expect(res.status).toBe(404);
  });

  it("returns 404 when the workout belongs to another athlete", async () => {
    const { upsert } = mockSupabase({
      workout: { id: WORKOUT_ID, user_id: OTHER_ATHLETE_ID },
    });

    const res = await callRoute({ rpe: 5 });

    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts on workout_id so a re-submission overwrites the first eval", async () => {
    const { upsert } = mockSupabase({
      upsertData: {
        id: "same-row-id",
        user_id: ATHLETE_ID,
        workout_id: WORKOUT_ID,
        rpe: 9,
        feedback: "second attempt",
      },
    });

    await callRoute({ rpe: 6, feedback: "first attempt" });
    const res = await callRoute({ rpe: 9, feedback: "second attempt" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eval.rpe).toBe(9);
    // Both writes target the same conflict key — the DB keeps one row.
    expect(upsert).toHaveBeenCalledTimes(2);
    for (const call of upsert.mock.calls) {
      expect(call[1]).toEqual({ onConflict: "workout_id" });
      expect(call[0].workout_id).toBe(WORKOUT_ID);
    }
  });
});
