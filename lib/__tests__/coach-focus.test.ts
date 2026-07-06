import { describe, it, expect } from "vitest";
import {
  derivePatternFocus,
  FOCUS_CONFIDENCE_MIN_COUNT,
} from "../coach-focus";
import type { WorkoutPatterns, WorkoutTypePattern } from "../coach-patterns";
import { PEAK_RPE, STRUGGLE_RPE } from "../coach-patterns";

function type(overrides: Partial<WorkoutTypePattern> = {}): WorkoutTypePattern {
  return { label: "Leg day", avgRpe: 8, count: 3, trend: "up", ...overrides };
}

/** Build a WorkoutPatterns the way detectWorkoutPatterns() would: peaks and
 * struggles derived from avgRpe, byWorkoutType keyed by lowercased label,
 * preserving the given insertion order. */
function patternsOf(types: WorkoutTypePattern[]): WorkoutPatterns {
  const byWorkoutType: WorkoutPatterns["byWorkoutType"] = {};
  for (const t of types) byWorkoutType[t.label.toLowerCase()] = t;
  return {
    byWorkoutType,
    peakTypes: types.filter((t) => t.avgRpe >= PEAK_RPE).map((t) => t.label),
    struggleTypes: types
      .filter((t) => t.avgRpe <= STRUGGLE_RPE)
      .map((t) => t.label),
    recommendations: [],
    windowDays: 30,
  };
}

const EMPTY: WorkoutPatterns = {
  byWorkoutType: {},
  peakTypes: [],
  struggleTypes: [],
  recommendations: [],
  windowDays: 0,
};

describe("derivePatternFocus — basic selection", () => {
  it("picks the single peak as push and the single struggle as pull_back", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Leg day", avgRpe: 8, trend: "up" }),
        type({ label: "Upper 1", avgRpe: 4.5, trend: "down" }),
      ]),
    );

    expect(focus.push_type).toBe("Leg day");
    expect(focus.pull_back_type).toBe("Upper 1");
    expect(focus.rationale).toHaveLength(2);
  });

  it("with only peaks, pull_back_type is null and push_type is set", () => {
    const focus = derivePatternFocus(
      patternsOf([type({ label: "Leg day", avgRpe: 8 })]),
    );

    expect(focus.push_type).toBe("Leg day");
    expect(focus.pull_back_type).toBeNull();
    expect(focus.rationale).toHaveLength(1);
  });

  it("with only struggles, push_type is null and pull_back_type is set", () => {
    const focus = derivePatternFocus(
      patternsOf([type({ label: "Upper 1", avgRpe: 4, trend: "down" })]),
    );

    expect(focus.push_type).toBeNull();
    expect(focus.pull_back_type).toBe("Upper 1");
    expect(focus.rationale).toHaveLength(1);
  });

  it("returns the all-null focus for the empty patterns shape, without throwing", () => {
    expect(derivePatternFocus(EMPTY)).toEqual({
      push_type: null,
      pull_back_type: null,
      rationale: [],
      confidence: null,
    });
  });

  it("returns the all-null focus when types exist but none is peak or struggle", () => {
    const focus = derivePatternFocus(
      patternsOf([type({ label: "Push", avgRpe: 6, trend: "stable" })]),
    );

    expect(focus.push_type).toBeNull();
    expect(focus.pull_back_type).toBeNull();
    expect(focus.confidence).toBeNull();
  });
});

describe("derivePatternFocus — peak tie-break chain", () => {
  it("highest avgRpe wins", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Bench", avgRpe: 7.5 }),
        type({ label: "Leg day", avgRpe: 9 }),
      ]),
    );

    expect(focus.push_type).toBe("Leg day");
  });

  it("on avgRpe tie, 'up' trend beats 'stable' and 'down'", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Bench", avgRpe: 8, trend: "stable" }),
        type({ label: "Leg day", avgRpe: 8, trend: "up" }),
        type({ label: "Pull", avgRpe: 8, trend: "down" }),
      ]),
    );

    expect(focus.push_type).toBe("Leg day");
  });

  it("on avgRpe and trend tie, higher count wins", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Bench", avgRpe: 8, trend: "up", count: 3 }),
        type({ label: "Leg day", avgRpe: 8, trend: "up", count: 5 }),
      ]),
    );

    expect(focus.push_type).toBe("Leg day");
  });

  it("on a full tie, alphabetical label wins", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Bench", avgRpe: 8, trend: "up", count: 3 }),
        type({ label: "Arms", avgRpe: 8, trend: "up", count: 3 }),
      ]),
    );

    expect(focus.push_type).toBe("Arms");
  });
});

describe("derivePatternFocus — struggle tie-break chain", () => {
  it("lowest avgRpe wins", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Upper 1", avgRpe: 4, trend: "down" }),
        type({ label: "Upper 2", avgRpe: 5, trend: "down" }),
      ]),
    );

    expect(focus.pull_back_type).toBe("Upper 1");
  });

  it("on avgRpe tie, 'down' trend beats 'stable' and 'up'", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Upper 1", avgRpe: 4, trend: "stable" }),
        type({ label: "Upper 2", avgRpe: 4, trend: "down" }),
        type({ label: "Upper 3", avgRpe: 4, trend: "up" }),
      ]),
    );

    expect(focus.pull_back_type).toBe("Upper 2");
  });

  it("on avgRpe and trend tie, higher count then alphabetical wins", () => {
    const byCount = derivePatternFocus(
      patternsOf([
        type({ label: "Upper 1", avgRpe: 4, trend: "down", count: 2 }),
        type({ label: "Upper 2", avgRpe: 4, trend: "down", count: 4 }),
      ]),
    );
    expect(byCount.pull_back_type).toBe("Upper 2");

    const byLabel = derivePatternFocus(
      patternsOf([
        type({ label: "Upper 2", avgRpe: 4, trend: "down", count: 2 }),
        type({ label: "Upper 1", avgRpe: 4, trend: "down", count: 2 }),
      ]),
    );
    expect(byLabel.pull_back_type).toBe("Upper 1");
  });
});

describe("derivePatternFocus — confidence", () => {
  it(`is 'high' when every chosen bucket has count >= ${FOCUS_CONFIDENCE_MIN_COUNT}`, () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Leg day", avgRpe: 8, count: FOCUS_CONFIDENCE_MIN_COUNT }),
        type({ label: "Upper 1", avgRpe: 4, count: 4, trend: "down" }),
      ]),
    );

    expect(focus.confidence).toBe("high");
  });

  it("is 'low' when the only chosen bucket is thin", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Leg day", avgRpe: 8, count: FOCUS_CONFIDENCE_MIN_COUNT - 1 }),
      ]),
    );

    expect(focus.confidence).toBe("low");
  });

  it("is 'low' when EITHER chosen bucket is thin (min of both)", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Leg day", avgRpe: 8, count: 5 }),
        type({ label: "Upper 1", avgRpe: 4, count: 2, trend: "down" }),
      ]),
    );

    expect(focus.confidence).toBe("low");
  });
});

describe("derivePatternFocus — rationale", () => {
  it("states the actual avgRpe and trend for each chosen type", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Leg day", avgRpe: 8, trend: "up" }),
        type({ label: "Upper 1", avgRpe: 4.5, trend: "down" }),
      ]),
    );

    expect(focus.rationale).toEqual([
      "Leg day averaging 8/10 and trending up",
      "Upper 1 averaging 4.5/10 and trending down",
    ]);
  });

  it("reads 'holding steady' for a stable trend", () => {
    const focus = derivePatternFocus(
      patternsOf([type({ label: "Leg day", avgRpe: 8, trend: "stable" })]),
    );

    expect(focus.rationale).toEqual([
      "Leg day averaging 8/10 and holding steady",
    ]);
  });

  it("never contains calendar-day language", () => {
    const focus = derivePatternFocus(
      patternsOf([
        type({ label: "Leg day", avgRpe: 8, trend: "up" }),
        type({ label: "Upper 1", avgRpe: 4.5, trend: "down" }),
      ]),
    );

    const dayWords =
      /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i;
    for (const line of focus.rationale) {
      expect(line).not.toMatch(dayWords);
    }
  });
});

describe("derivePatternFocus — determinism", () => {
  it("returns identical output regardless of input order", () => {
    const types = [
      type({ label: "Bench", avgRpe: 8, trend: "up", count: 3 }),
      type({ label: "Arms", avgRpe: 8, trend: "up", count: 3 }),
      type({ label: "Leg day", avgRpe: 9, trend: "stable", count: 2 }),
      type({ label: "Upper 1", avgRpe: 4, trend: "down", count: 2 }),
      type({ label: "Upper 2", avgRpe: 4, trend: "down", count: 2 }),
    ];

    const forward = derivePatternFocus(patternsOf(types));
    const reversed = derivePatternFocus(patternsOf([...types].reverse()));

    expect(reversed).toEqual(forward);
    expect(forward.push_type).toBe("Leg day");
    expect(forward.pull_back_type).toBe("Upper 1");
  });
});
