import { describe, it, expect } from "vitest";
import {
  buildTemporalSummary,
  TEMPORAL_WINDOW_DAYS,
  SEASONALITY_MIN_SPAN_DAYS,
} from "../coach-temporal";

// Fixed "today" so every window and block boundary is deterministic.
const TODAY = "2026-07-06";
const MS_PER_DAY = 86_400_000;

/** YYYY-MM-DD `daysAgo` days before TODAY. */
function date(daysAgo: number): string {
  return new Date(Date.parse(TODAY + "T00:00:00Z") - daysAgo * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function session(daysAgo: number, id = `s${daysAgo}`, status = "completed") {
  return { id, session_date: date(daysAgo), status };
}

function checkin(daysAgo: number, types: string[], intensity?: number) {
  return {
    checkin_date: date(daysAgo),
    workout_types: types,
    workout_intensity: intensity,
  };
}

describe("buildTemporalSummary — window & span", () => {
  it("works on a short span (< 30 days)", () => {
    const result = buildTemporalSummary(
      [session(5), session(1)],
      [],
      [],
      TODAY,
    );
    expect(result.window.daysSpanned).toBe(5);
    expect(result.window.from).toBe(date(5));
    expect(result.window.to).toBe(TODAY);
    expect(result.seasonality).toBeNull();
  });

  it("caps the span at 180 days by dropping older rows", () => {
    const sessions = Array.from({ length: 220 }, (_, i) => session(i, `s${i}`));
    const result = buildTemporalSummary(sessions, [], [], TODAY);
    expect(result.window.daysSpanned).toBeLessThanOrEqual(TEMPORAL_WINDOW_DAYS);
    // Sessions older than the window must not count toward frequency either.
    expect(result.frequency.totalSessions).toBe(181); // days 0..180 inclusive
  });

  it("does not assume input ordering (newest-first input works)", () => {
    // lib/context.ts fetches newest first — oldest must still anchor the window.
    const result = buildTemporalSummary(
      [session(1), session(20), session(10)],
      [],
      [],
      TODAY,
    );
    expect(result.window.from).toBe(date(20));
    expect(result.window.daysSpanned).toBe(20);
  });

  it("returns the empty summary for no sessions", () => {
    const result = buildTemporalSummary([], [], [], TODAY);
    expect(result.window.daysSpanned).toBe(0);
    expect(result.frequency.totalSessions).toBe(0);
    expect(result.volumeArc).toEqual([]);
    expect(result.fatigueSignal).toBeNull();
    expect(result.restRhythm.inference).toBe("insufficient_data");
    expect(result.seasonality).toBeNull();
  });
});

describe("buildTemporalSummary — frequency", () => {
  it("computes sessions per week over the span", () => {
    // 10 completed sessions across 14 days → 5.0/week.
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session(14 - i, `s${i}`),
    );
    const result = buildTemporalSummary(sessions, [], [], TODAY);
    expect(result.frequency.totalSessions).toBe(10);
    expect(result.frequency.sessionsPerWeek).toBe(5);
    expect(result.frequency.consistency).toBe("exceptional consistency");
  });

  it("counts only completed sessions toward frequency", () => {
    const result = buildTemporalSummary(
      [session(7), session(3, "s3", "in_progress"), session(1)],
      [],
      [],
      TODAY,
    );
    expect(result.frequency.totalSessions).toBe(2);
  });
});

describe("buildTemporalSummary — type breakdown", () => {
  it("groups by workout_types and averages intensity", () => {
    const checkins = [
      checkin(10, ["strength"], 7),
      checkin(5, ["strength"], 7),
      checkin(3, ["hypertrophy"], 8),
      checkin(2, ["hypertrophy"], 9),
    ];
    const result = buildTemporalSummary([session(10)], [], checkins, TODAY);
    expect(result.typeBreakdown["strength"]).toEqual({
      count: 2,
      avgIntensity: 7,
      trend: "stable",
    });
    expect(result.typeBreakdown["hypertrophy"].avgIntensity).toBe(8.5);
  });

  it("detects an upward intensity trend past the ±0.5 delta", () => {
    const checkins = [
      checkin(20, ["strength"], 5),
      checkin(15, ["strength"], 5),
      checkin(10, ["strength"], 7),
      checkin(5, ["strength"], 7),
    ];
    const result = buildTemporalSummary([session(20)], [], checkins, TODAY);
    expect(result.typeBreakdown["strength"].trend).toBe("up");
  });

  it("drops types with fewer than 2 intensity samples", () => {
    const result = buildTemporalSummary(
      [session(10)],
      [],
      [checkin(5, ["cardio_hard"], 5)],
      TODAY,
    );
    expect(result.typeBreakdown["cardio_hard"]).toBeUndefined();
  });

  it("ignores check-ins without an intensity rating", () => {
    const result = buildTemporalSummary(
      [session(10)],
      [],
      [checkin(5, ["strength"]), checkin(4, ["strength"])],
      TODAY,
    );
    expect(result.typeBreakdown["strength"]).toBeUndefined();
  });
});

describe("buildTemporalSummary — volume arc", () => {
  // Two full 4-week blocks: sessions at days 56..29 (block 1) and 28..1 (block 2).
  function twoBlockFixture(block1Tonnage: number, block2Tonnage: number) {
    const sessions = [session(56, "a"), session(29, "b"), session(28, "c"), session(1, "d")];
    const setLogs = [
      { session_id: "a", weight: block1Tonnage / 2, reps: 1 },
      { session_id: "b", weight: block1Tonnage / 2, reps: 1 },
      { session_id: "c", weight: block2Tonnage / 2, reps: 1 },
      { session_id: "d", weight: block2Tonnage / 2, reps: 1 },
    ];
    return buildTemporalSummary(sessions, setLogs, [], TODAY);
  }

  it("aggregates tonnage (weight × reps) into 4-week blocks", () => {
    const result = twoBlockFixture(1000, 2000);
    expect(result.volumeArc.length).toBeGreaterThanOrEqual(2);
    expect(result.volumeArc[0]).toMatchObject({
      weekLabel: "Week 1-4",
      totalTonnage: 1000,
      trend: "insufficient_data", // first block has nothing to compare against
    });
    expect(result.volumeArc[1].totalTonnage).toBe(2000);
  });

  it("labels climbing / plateau / declining vs the previous block (±10%)", () => {
    expect(twoBlockFixture(1000, 1200).volumeArc[1].trend).toBe("climbing");
    expect(twoBlockFixture(1000, 1050).volumeArc[1].trend).toBe("plateau");
    expect(twoBlockFixture(1000, 800).volumeArc[1].trend).toBe("declining");
  });

  it("marks a block insufficient_data when the previous block had no tonnage", () => {
    const result = twoBlockFixture(0, 1000);
    expect(result.volumeArc[1].trend).toBe("insufficient_data");
  });
});

describe("buildTemporalSummary — fatigue signal", () => {
  it("detects overreach: intensity drops ≥ 1 point while block tonnage is high", () => {
    // Block 1: intensity 8, low tonnage. Block 2: intensity 6 (drop 2),
    // highest tonnage → moderate overreach in block 2.
    const sessions = [session(40, "a"), session(10, "b")];
    const setLogs = [
      { session_id: "a", weight: 100, reps: 10 }, // 1,000 lbs
      { session_id: "b", weight: 500, reps: 10 }, // 5,000 lbs — the heavy block
    ];
    const checkins = [checkin(40, ["strength"], 8), checkin(10, ["strength"], 6)];
    const result = buildTemporalSummary(sessions, setLogs, checkins, TODAY);
    expect(result.fatigueSignal).toEqual({
      detected: true,
      when: "Week 5-8",
      severity: "moderate",
    });
  });

  it("stays null when intensity holds while volume climbs", () => {
    const sessions = [session(40, "a"), session(10, "b")];
    const setLogs = [
      { session_id: "a", weight: 100, reps: 10 },
      { session_id: "b", weight: 500, reps: 10 },
    ];
    const checkins = [checkin(40, ["strength"], 8), checkin(10, ["strength"], 8)];
    const result = buildTemporalSummary(sessions, setLogs, checkins, TODAY);
    expect(result.fatigueSignal).toBeNull();
  });
});

describe("buildTemporalSummary — rest rhythm", () => {
  it("computes gap stats from session dates", () => {
    // Gaps: 2d, 3d → avg 2.5, max 3, none strictly over 3.
    const result = buildTemporalSummary(
      [session(5), session(3), session(0, "s0")],
      [],
      [],
      TODAY,
    );
    expect(result.restRhythm).toEqual({
      avgGapDays: 2.5,
      maxGapDays: 3,
      gapsOver3d: 0,
      inference: "consistent",
    });
  });

  it("counts gaps strictly over 3 days and infers 'variable'", () => {
    // Gaps: 1d, 4d, 1d, 5d → 2 of 4 over 3d (> 25%).
    const result = buildTemporalSummary(
      [session(11), session(10), session(6), session(5), session(0, "s0")],
      [],
      [],
      TODAY,
    );
    expect(result.restRhythm.gapsOver3d).toBe(2);
    expect(result.restRhythm.inference).toBe("variable");
  });

  it("infers 'long_break' from any gap of 7+ days", () => {
    const result = buildTemporalSummary(
      [session(10), session(2)],
      [],
      [],
      TODAY,
    );
    expect(result.restRhythm.maxGapDays).toBe(8);
    expect(result.restRhythm.inference).toBe("long_break");
  });
});

describe("buildTemporalSummary — seasonality", () => {
  it("is null below the 120-day span gate", () => {
    const result = buildTemporalSummary(
      [session(90), session(1)],
      [],
      [checkin(90, ["strength"], 7), checkin(1, ["strength"], 8)],
      TODAY,
    );
    expect(result.window.daysSpanned).toBe(90);
    expect(result.seasonality).toBeNull();
  });

  it("renders month-by-month one-liners keyed YYYY-MM once span ≥ 120 days", () => {
    const result = buildTemporalSummary(
      [session(SEASONALITY_MIN_SPAN_DAYS), session(1)],
      [],
      [
        checkin(SEASONALITY_MIN_SPAN_DAYS, ["strength"], 6), // 2026-03-08
        checkin(1, ["strength"], 8), // 2026-07-05
      ],
      TODAY,
    );
    expect(result.seasonality).toEqual({
      "2026-03": "avg intensity 6.0",
      "2026-07": "avg intensity 8.0",
    });
  });
});

describe("buildTemporalSummary — determinism", () => {
  it("same input → same output", () => {
    const sessions = [session(10), session(5), session(1)];
    const setLogs = [{ session_id: "s10", weight: 135, reps: 8 }];
    const checkins = [checkin(10, ["strength"], 7), checkin(5, ["strength"], 8)];
    const a = buildTemporalSummary(sessions, setLogs, checkins, TODAY);
    const b = buildTemporalSummary(sessions, setLogs, checkins, TODAY);
    expect(a).toEqual(b);
  });
});
