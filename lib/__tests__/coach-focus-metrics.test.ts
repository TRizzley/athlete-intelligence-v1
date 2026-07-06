import { describe, it, expect } from "vitest";
import { summarizeFocusCoverage } from "../coach-focus-metrics";
import type { PatternFocus } from "../coach-focus";

type FocusBrief = Pick<
  PatternFocus,
  "push_type" | "pull_back_type" | "confidence"
>;

function focus(overrides: Partial<FocusBrief> = {}): FocusBrief {
  return {
    push_type: "Leg day",
    pull_back_type: "Upper 1",
    confidence: "high",
    ...overrides,
  };
}

const NULL_FOCUS: FocusBrief = {
  push_type: null,
  pull_back_type: null,
  confidence: null,
};

describe("summarizeFocusCoverage", () => {
  it("counts actionable and high-confidence athletes over a mixed set", () => {
    const coverage = summarizeFocusCoverage([
      focus(), // actionable, high
      focus({ pull_back_type: null, confidence: "low" }), // actionable, low
      focus({ push_type: null, confidence: "low" }), // actionable (pull only), low
      NULL_FOCUS, // not actionable
    ]);

    expect(coverage).toEqual({
      total: 4,
      withActionableFocus: 3,
      highConfidence: 1,
      pct_actionable: 75,
      pct_high_confidence: 25,
    });
  });

  it("reads 0% with no NaN when every focus is null", () => {
    const coverage = summarizeFocusCoverage([NULL_FOCUS, NULL_FOCUS]);

    expect(coverage).toEqual({
      total: 2,
      withActionableFocus: 0,
      highConfidence: 0,
      pct_actionable: 0,
      pct_high_confidence: 0,
    });
  });

  it("returns all zeros for empty input without throwing", () => {
    expect(summarizeFocusCoverage([])).toEqual({
      total: 0,
      withActionableFocus: 0,
      highConfidence: 0,
      pct_actionable: 0,
      pct_high_confidence: 0,
    });
  });

  it("reads 100.0 on both percentages when everyone is actionable and high-confidence", () => {
    const coverage = summarizeFocusCoverage([focus(), focus(), focus()]);

    expect(coverage.pct_actionable).toBe(100);
    expect(coverage.pct_high_confidence).toBe(100);
  });

  it("rounds percentages to 1 decimal (1 of 3 -> 33.3)", () => {
    const coverage = summarizeFocusCoverage([
      focus({ confidence: "low" }),
      NULL_FOCUS,
      NULL_FOCUS,
    ]);

    expect(coverage.pct_actionable).toBe(33.3);
    expect(coverage.pct_high_confidence).toBe(0);
  });
});
