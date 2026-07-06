import { describe, it, expect } from "vitest";
import { detectWorkoutPatterns } from "../coach-patterns";
import type { SelfEvalBrief } from "../coach-types";

// Fixed "today" so the 30-day window is deterministic.
const TODAY = "2026-07-05";

// Eval `daysAgo` days before TODAY. Defaults name a leg workout.
function ev(
  daysAgo: number,
  rpe: number,
  day_name: string | null = "Leg day",
  feedback: string | null = null,
): SelfEvalBrief {
  const d = new Date(Date.parse(TODAY + "T00:00:00Z") - daysAgo * 86_400_000);
  return { workout_date: d.toISOString().slice(0, 10), day_name, rpe, feedback };
}

describe("detectWorkoutPatterns — grouping", () => {
  it("groups evals by workout type and averages RPE", () => {
    const result = detectWorkoutPatterns([ev(1, 8), ev(3, 8)], TODAY);

    expect(result.byWorkoutType).toEqual({
      "leg day": { label: "Leg day", avgRpe: 8, count: 2, trend: "stable" },
    });
    expect(result.windowDays).toBe(30);
  });

  it("rounds the average to one decimal", () => {
    // (7 + 8) / 2 = 7.5
    const result = detectWorkoutPatterns([ev(1, 7), ev(3, 8)], TODAY);

    expect(result.byWorkoutType["leg day"].avgRpe).toBe(7.5);
  });

  it("collapses spellings of the same workout into one bucket", () => {
    const result = detectWorkoutPatterns(
      [ev(1, 8, "CHEST"), ev(3, 7, "chest"), ev(5, 6, "Chest")],
      TODAY,
    );

    expect(Object.keys(result.byWorkoutType)).toEqual(["chest"]);
    expect(result.byWorkoutType["chest"].count).toBe(3);
  });

  it("labels a bucket with the most recent original spelling", () => {
    const result = detectWorkoutPatterns(
      [ev(1, 8, "CHEST"), ev(3, 7, "Chest")],
      TODAY,
    );

    expect(result.byWorkoutType["chest"].label).toBe("CHEST");
  });

  it("buckets null and blank day_name as Ad-hoc", () => {
    const result = detectWorkoutPatterns(
      [ev(1, 6, null), ev(3, 6, "   ")],
      TODAY,
    );

    expect(result.byWorkoutType).toEqual({
      "ad-hoc": { label: "Ad-hoc", avgRpe: 6, count: 2, trend: "stable" },
    });
  });

  it("drops buckets with fewer than 2 evals", () => {
    const result = detectWorkoutPatterns(
      [ev(1, 8, "Leg day"), ev(2, 9, "Push"), ev(4, 8, "Leg day")],
      TODAY,
    );

    expect(Object.keys(result.byWorkoutType)).toEqual(["leg day"]);
  });
});

describe("detectWorkoutPatterns — 30-day window", () => {
  it("includes an eval exactly 30 days ago and excludes one 31 days ago", () => {
    const result = detectWorkoutPatterns(
      [ev(1, 8), ev(30, 8), ev(31, 1)],
      TODAY,
    );

    expect(result.byWorkoutType["leg day"].count).toBe(2);
    expect(result.byWorkoutType["leg day"].avgRpe).toBe(8); // the 31-day-old 1 is out
  });

  it("excludes evals with an empty workout_date instead of NaN-comparing", () => {
    const blank = { workout_date: "", day_name: "Leg day", rpe: 9, feedback: null };
    const result = detectWorkoutPatterns([blank, blank, ev(1, 6), ev(3, 6)], TODAY);

    expect(result.byWorkoutType["leg day"].count).toBe(2);
    expect(result.byWorkoutType["leg day"].avgRpe).toBe(6);
    expect(result.windowDays).toBe(30);
  });

  it("returns the empty shape for no evals, without throwing", () => {
    expect(detectWorkoutPatterns([], TODAY)).toEqual({
      byWorkoutType: {},
      peakTypes: [],
      struggleTypes: [],
      recommendations: [],
      windowDays: 0,
    });
  });
});

describe("detectWorkoutPatterns — peak and struggle classification", () => {
  it("marks avg RPE >= 7 as peak and <= 5 as struggle, by display label", () => {
    const result = detectWorkoutPatterns(
      [ev(1, 8, "Leg day"), ev(3, 7, "Leg day"), ev(2, 4, "Push"), ev(4, 5, "Push")],
      TODAY,
    );

    expect(result.peakTypes).toEqual(["Leg day"]);
    expect(result.struggleTypes).toEqual(["Push"]);
  });

  it("leaves mid-range types out of both lists", () => {
    const result = detectWorkoutPatterns([ev(1, 6), ev(3, 6)], TODAY);

    expect(result.peakTypes).toEqual([]);
    expect(result.struggleTypes).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });
});

describe("detectWorkoutPatterns — trend", () => {
  it("detects an upward trend when later evals average > 0.5 above earlier", () => {
    // Chronological RPEs: 6, 6, 8, 9 → first half 6, second half 8.5
    const result = detectWorkoutPatterns(
      [ev(1, 9), ev(3, 8), ev(5, 6), ev(7, 6)],
      TODAY,
    );

    expect(result.byWorkoutType["leg day"].trend).toBe("up");
  });

  it("detects a downward trend when later evals average > 0.5 below earlier", () => {
    // Chronological RPEs: 9, 8, 6, 6 → first half 8.5, second half 6
    const result = detectWorkoutPatterns(
      [ev(1, 6), ev(3, 6), ev(5, 8), ev(7, 9)],
      TODAY,
    );

    expect(result.byWorkoutType["leg day"].trend).toBe("down");
  });

  it("calls a gap of exactly 0.5 stable", () => {
    // Chronological RPEs: 7, 7, 7, 8 → first half 7, second half 7.5
    const result = detectWorkoutPatterns(
      [ev(1, 8), ev(3, 7), ev(5, 7), ev(7, 7)],
      TODAY,
    );

    expect(result.byWorkoutType["leg day"].trend).toBe("stable");
  });

  it("sorts each bucket chronologically regardless of input order", () => {
    // Same evals as the 'up' case but oldest first: trend must not flip.
    const result = detectWorkoutPatterns(
      [ev(7, 6), ev(5, 6), ev(3, 8), ev(1, 9)],
      TODAY,
    );

    expect(result.byWorkoutType["leg day"].trend).toBe("up");
  });
});

describe("detectWorkoutPatterns — recommendations", () => {
  it("names peak and struggle types with no calendar-day language", () => {
    const result = detectWorkoutPatterns(
      [ev(1, 8, "Leg day"), ev(3, 8, "Leg day"), ev(2, 4, "Push"), ev(4, 4, "Push")],
      TODAY,
    );

    expect(result.recommendations).toEqual([
      "You perform strongest on Leg day. Good days to push intensity.",
      "Push are consistently lower. Consider recovery focus or technique work there.",
    ]);
    const joined = result.recommendations.join(" ");
    for (const day of [
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]) {
      expect(joined).not.toContain(day);
    }
  });
});
