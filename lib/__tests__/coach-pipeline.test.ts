// End-to-end composition test for the self-eval coaching pipeline (Milestone
// B3): proves the exact chain buildContextText() runs — summarizeSelfEvals ->
// detectWorkoutPatterns -> derivePatternFocus — composes correctly over one
// fixed in-memory athlete, and that the rendered context carries all three
// sections in order. No DB, no mocks: these are the real pure functions.
import { describe, it, expect } from "vitest";
import { summarizeSelfEvals } from "../coach-evals";
import { detectWorkoutPatterns } from "../coach-patterns";
import { derivePatternFocus } from "../coach-focus";
import { buildContextText } from "../coach-context";
import type { CoachContext, SelfEvalBrief } from "../coach-types";

const TODAY = "2026-07-04";

// Newest first — the order lib/context.ts fetches. Two clear workout types
// (Leg day peaking, Upper 1 struggling), two unnamed evals for the Ad-hoc
// bucket, and one stale Leg day eval outside the 30-day window (cutoff
// 2026-06-04) that must not drag the Leg day average.
const DEMO_EVALS: SelfEvalBrief[] = [
  { workout_date: "2026-07-03", day_name: "Leg day", rpe: 9, feedback: "felt unstoppable" },
  { workout_date: "2026-07-02", day_name: "Upper 1", rpe: 4, feedback: "arms dead" },
  { workout_date: "2026-07-01", day_name: "Leg day", rpe: 8, feedback: null },
  { workout_date: "2026-06-30", day_name: "Upper 1", rpe: 5, feedback: null },
  { workout_date: "2026-06-29", day_name: "Leg day", rpe: 7, feedback: null },
  { workout_date: "2026-06-28", day_name: "Upper 1", rpe: 5, feedback: "meh" },
  { workout_date: "2026-06-27", day_name: null, rpe: 6, feedback: null },
  { workout_date: "2026-06-25", day_name: null, rpe: 6, feedback: null },
  { workout_date: "2026-05-01", day_name: "Leg day", rpe: 2, feedback: "out of window" },
];

describe("self-eval pipeline — summarize -> patterns -> focus", () => {
  it("summarizes the raw evals (newest 5) independently of type grouping", () => {
    const summary = summarizeSelfEvals(DEMO_EVALS);

    expect(summary.avgRPE).toBe(6.6); // (9+4+8+5+7)/5
    expect(summary.rpeCount).toBe(9);
    expect(summary.rpeTrend).toBe("up"); // 9 vs 4
    expect(summary.recentFeedback).toBe("felt unstoppable");
  });

  it("groups by workout type, buckets unnamed evals as Ad-hoc, and excludes the out-of-window eval", () => {
    const patterns = detectWorkoutPatterns(DEMO_EVALS, TODAY);

    expect(Object.keys(patterns.byWorkoutType).sort()).toEqual([
      "ad-hoc",
      "leg day",
      "upper 1",
    ]);

    // The stale rpe-2 eval is excluded: count stays 3 and the average stays
    // 8 (it would be 6.5 over 4 evals if the window leaked).
    expect(patterns.byWorkoutType["leg day"]).toEqual({
      label: "Leg day",
      avgRpe: 8,
      count: 3,
      trend: "up",
    });
    expect(patterns.byWorkoutType["upper 1"]).toEqual({
      label: "Upper 1",
      avgRpe: 4.7,
      count: 3,
      trend: "down",
    });
    expect(patterns.byWorkoutType["ad-hoc"]).toEqual({
      label: "Ad-hoc",
      avgRpe: 6,
      count: 2,
      trend: "stable",
    });

    expect(patterns.peakTypes).toEqual(["Leg day"]);
    expect(patterns.struggleTypes).toEqual(["Upper 1"]);
  });

  it("derives the focus directive from those patterns", () => {
    const focus = derivePatternFocus(detectWorkoutPatterns(DEMO_EVALS, TODAY));

    expect(focus).toEqual({
      push_type: "Leg day",
      pull_back_type: "Upper 1",
      confidence: "high", // both chosen buckets have count 3
      rationale: [
        "Leg day averaging 8/10 and trending up",
        "Upper 1 averaging 4.7/10 and trending down",
      ],
    });
  });

  it("renders all three sections in order in the real context, with no calendar-day language", () => {
    const ctx: CoachContext = {
      athleteName: "Demo Athlete",
      today: TODAY,
      profile: null,
      latestCheckin: null,
      recentCheckins: [],
      screenshots: [],
      memoryNotes: [],
      previousResponses: [],
      predictions: [],
      feedback: [],
      selfEvals: DEMO_EVALS,
    };
    const text = buildContextText(ctx);

    const evalsAt = text.indexOf("ATHLETE SELF-EVALS");
    const patternsAt = text.indexOf("WORKOUT PATTERNS");
    const focusAt = text.indexOf("SUGGESTED FOCUS");
    expect(evalsAt).toBeGreaterThan(-1);
    expect(patternsAt).toBeGreaterThan(evalsAt);
    expect(focusAt).toBeGreaterThan(patternsAt);

    expect(text).toContain('"push_type":"Leg day"');
    expect(text).toContain('"pull_back_type":"Upper 1"');
    expect(text).toContain('"confidence":"high"');

    expect(text).not.toMatch(
      /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
    );
  });
});
