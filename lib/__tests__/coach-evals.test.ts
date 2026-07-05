import { describe, it, expect } from "vitest";
import { summarizeSelfEvals } from "../coach-evals";
import type { SelfEvalBrief } from "../coach-types";

// Newest first, like lib/context.ts fetches them.
function evalWith(rpe: number, feedback: string | null = null): SelfEvalBrief {
  return { workout_date: "2026-07-03", day_name: "Push", rpe, feedback };
}

describe("summarizeSelfEvals", () => {
  it("returns the all-null shape for no evals", () => {
    expect(summarizeSelfEvals([])).toEqual({
      avgRPE: null,
      recentFeedback: null,
      rpeCount: 0,
      rpeTrend: null,
    });
  });

  it("computes avg, count, feedback, and trend from 5 evals", () => {
    const result = summarizeSelfEvals([
      evalWith(8, "felt strong"),
      evalWith(6, "hit plateau"),
      evalWith(7),
      evalWith(7),
      evalWith(6),
    ]);

    expect(result.avgRPE).toBe(6.8);
    expect(result.rpeCount).toBe(5);
    expect(result.recentFeedback).toBe("felt strong");
    expect(result.rpeTrend).toBe("up"); // newest 8 > previous 6
  });

  it("detects an 'up' trend (chronological 6 then 8 → newest-first [8, 6])", () => {
    expect(summarizeSelfEvals([evalWith(8), evalWith(6)]).rpeTrend).toBe("up");
  });

  it("detects a 'down' trend (chronological 8 then 6 → newest-first [6, 8])", () => {
    expect(summarizeSelfEvals([evalWith(6), evalWith(8)]).rpeTrend).toBe("down");
  });

  it("detects a 'stable' trend on exact equality", () => {
    expect(summarizeSelfEvals([evalWith(7), evalWith(7)]).rpeTrend).toBe("stable");
  });

  it("returns null trend with a single eval", () => {
    const result = summarizeSelfEvals([evalWith(9, "new PR")]);

    expect(result.rpeTrend).toBeNull();
    expect(result.avgRPE).toBe(9);
    expect(result.rpeCount).toBe(1);
    expect(result.recentFeedback).toBe("new PR");
  });

  it("averages only the newest 5 when more evals are provided", () => {
    // Newest five are all 8; the older two 1s must not drag the average down.
    const result = summarizeSelfEvals([
      evalWith(8),
      evalWith(8),
      evalWith(8),
      evalWith(8),
      evalWith(8),
      evalWith(1),
      evalWith(1),
    ]);

    expect(result.avgRPE).toBe(8);
    expect(result.rpeCount).toBe(7);
  });

  it("rounds the average to one decimal", () => {
    // (7 + 8 + 8) / 3 = 7.666... → 7.7
    expect(summarizeSelfEvals([evalWith(7), evalWith(8), evalWith(8)]).avgRPE).toBe(7.7);
  });

  it("does not substitute older feedback when the newest eval has none", () => {
    const result = summarizeSelfEvals([
      evalWith(7, null),
      evalWith(6, "felt tired"),
    ]);

    expect(result.recentFeedback).toBeNull();
  });
});
