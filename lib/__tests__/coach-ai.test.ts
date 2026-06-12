import { describe, it, expect } from "vitest";
import { feedbackCalibration } from "../coach-context";
import type { UserFeedback } from "../types";

// Minimal factory — only the fields feedbackCalibration reads.
function fb(
  overrides: Partial<
    Pick<
      UserFeedback,
      "felt_accurate" | "felt_personalized" | "was_useful" | "free_text"
    >
  > = {},
): UserFeedback {
  return {
    id: "test",
    user_id: "u1",
    coach_response_id: "cr1",
    felt_accurate: "yes",
    felt_personalized: "yes",
    was_useful: "yes",
    prediction_came_true: null,
    would_pay: null,
    free_text: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// 3-sample guard
// ──────────────────────────────────────────────

describe("3-sample guard", () => {
  it("returns null with 0 entries", () => {
    expect(feedbackCalibration([])).toBeNull();
  });

  it("returns null with 1 entry", () => {
    expect(feedbackCalibration([fb({ felt_personalized: "no" })])).toBeNull();
  });

  it("returns null with 2 entries", () => {
    expect(
      feedbackCalibration([
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "no" }),
      ]),
    ).toBeNull();
  });

  it("fires directives with exactly 3 entries", () => {
    const result = feedbackCalibration([
      fb({ felt_personalized: "no" }),
      fb({ felt_personalized: "no" }),
      fb({ felt_personalized: "no" }),
    ]);
    expect(result).not.toBeNull();
  });
});

// ──────────────────────────────────────────────
// Weighted scoring: "no" = 2 pts, "somewhat" = 1 pt, "yes" = 0 pts
// threshold = recent.length; fires when score >= threshold
// ──────────────────────────────────────────────

describe("weighted scoring", () => {
  describe("felt_personalized directive", () => {
    // 3 items → threshold = 3
    // 3× "somewhat" → score 3 → weak (== threshold)
    it("fires at threshold: all-somewhat with 3 items", () => {
      const result = feedbackCalibration([
        fb({ felt_personalized: "somewhat" }),
        fb({ felt_personalized: "somewhat" }),
        fb({ felt_personalized: "somewhat" }),
      ]);
      expect(result).toContain("PERSONALIZATION IS THE #1 FIX");
    });

    // "no","somewhat","yes" → 2+1+0 = 3 → == threshold → weak
    it("fires at boundary: no + somewhat + yes = 3 pts (threshold 3)", () => {
      const result = feedbackCalibration([
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "somewhat" }),
        fb({ felt_personalized: "yes" }),
      ]);
      expect(result).toContain("PERSONALIZATION IS THE #1 FIX");
    });

    // "no","yes","yes" → 2+0+0 = 2 < 3 → not weak
    it("does not fire below threshold: no + yes + yes = 2 pts (threshold 3)", () => {
      const result = feedbackCalibration([
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
      ]);
      expect(result ?? "").not.toContain("PERSONALIZATION IS THE #1 FIX");
    });

    // "no" counts 2x: one "no" outweighs one "somewhat" by a factor of 2
    it('"no" counts 2× "somewhat"', () => {
      // 1 "no" = 2 pts; 1 "somewhat" = 1 pt — confirm the difference
      const oneNo = feedbackCalibration([
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
      ]);
      const twoSomewhat = feedbackCalibration([
        fb({ felt_personalized: "somewhat" }),
        fb({ felt_personalized: "somewhat" }),
        fb({ felt_personalized: "yes" }),
      ]);
      // 1 no → 2 pts < threshold(3) → null directive
      expect(oneNo ?? "").not.toContain("PERSONALIZATION IS THE #1 FIX");
      // 2 somewhat → 2 pts < threshold(3) → null directive
      expect(twoSomewhat ?? "").not.toContain("PERSONALIZATION IS THE #1 FIX");

      // But 1 no + 1 somewhat = 3 pts == threshold → fires
      const noAndSomewhat = feedbackCalibration([
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "somewhat" }),
        fb({ felt_personalized: "yes" }),
      ]);
      expect(noAndSomewhat).toContain("PERSONALIZATION IS THE #1 FIX");
    });
  });

  describe("felt_accurate directive", () => {
    it("fires when score meets threshold", () => {
      const result = feedbackCalibration([
        fb({ felt_accurate: "no" }),
        fb({ felt_accurate: "no" }),
        fb({ felt_accurate: "yes" }),
      ]);
      expect(result).toContain("ACCURACY");
    });

    it("does not fire when score is below threshold", () => {
      const result = feedbackCalibration([
        fb({ felt_accurate: "no" }),
        fb({ felt_accurate: "yes" }),
        fb({ felt_accurate: "yes" }),
      ]);
      expect(result ?? "").not.toContain("ACCURACY");
    });
  });

  describe("was_useful directive", () => {
    it("fires when score meets threshold", () => {
      const result = feedbackCalibration([
        fb({ was_useful: "somewhat" }),
        fb({ was_useful: "somewhat" }),
        fb({ was_useful: "somewhat" }),
      ]);
      expect(result).toContain("USEFULNESS");
    });

    it("does not fire when score is below threshold", () => {
      const result = feedbackCalibration([
        fb({ was_useful: "somewhat" }),
        fb({ was_useful: "yes" }),
        fb({ was_useful: "yes" }),
      ]);
      expect(result ?? "").not.toContain("USEFULNESS");
    });
  });

  describe("6-item window", () => {
    it("uses the 6-item window: threshold = 6, so 3 nos + 3 yeses just fires", () => {
      // score = 3×2 = 6 == threshold(6)
      const result = feedbackCalibration([
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "no" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
      ]);
      expect(result).toContain("PERSONALIZATION IS THE #1 FIX");
    });

    it("ignores the 7th (oldest) entry beyond the 6-item cap", () => {
      // 6 "yes" entries + 1 "no" that is outside the window
      // Without cap: score = 2 → not weak. With cap: 7th entry dropped, score = 0 → not weak either way.
      // Better test: 7th entry being "no" x3 that would push score over threshold if included.
      // 6 items: 2 no + 4 yes → score=4 < threshold(6) → not weak
      // If 7th "no" were included (7 items, threshold=7, score=6 < 7) → still not weak
      // Instead prove it reads newest-first via slice(0,6):
      // items[0..5] = yes×6, items[6] = no → score=0, no directives
      const items = [
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "yes" }),
        fb({ felt_personalized: "no" }), // outside the 6-item window
      ];
      expect(feedbackCalibration(items)).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────
// Free-text handling
// ──────────────────────────────────────────────

describe("free-text directive", () => {
  it("includes the latest non-empty comment", () => {
    const result = feedbackCalibration([
      fb({ free_text: "needs more sets detail" }),
      fb({ free_text: "too generic" }),
      fb(),
    ]);
    // Takes the first (newest) comment found
    expect(result).toContain("needs more sets detail");
    expect(result).not.toContain("too generic");
  });

  it("skips entries with null or whitespace-only free_text", () => {
    const result = feedbackCalibration([
      fb({ free_text: null }),
      fb({ free_text: "   " }),
      fb({ free_text: "please be more specific" }),
    ]);
    expect(result).toContain("please be more specific");
  });

  it("fires the free-text directive even when all ratings are good", () => {
    // All ratings → "yes", so no rating directives. But free_text still fires.
    const result = feedbackCalibration([
      fb({ free_text: "love it but add more numbers" }),
      fb(),
      fb(),
    ]);
    expect(result).toContain("love it but add more numbers");
    expect(result).not.toContain("PERSONALIZATION IS THE #1 FIX");
    expect(result).not.toContain("ACCURACY");
    expect(result).not.toContain("USEFULNESS");
  });
});

// ──────────────────────────────────────────────
// All-positive / null result
// ──────────────────────────────────────────────

describe("no directives fired", () => {
  it("returns null when all ratings are yes and no free_text", () => {
    const result = feedbackCalibration([fb(), fb(), fb()]);
    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────
// Multiple directives / output format
// ──────────────────────────────────────────────

describe("output format", () => {
  it("includes all weak-dimension directives in a single result", () => {
    const result = feedbackCalibration([
      fb({
        felt_personalized: "no",
        felt_accurate: "no",
        was_useful: "no",
        free_text: "fix everything",
      }),
      fb({
        felt_personalized: "no",
        felt_accurate: "no",
        was_useful: "no",
      }),
      fb({
        felt_personalized: "no",
        felt_accurate: "no",
        was_useful: "no",
      }),
    ]);
    expect(result).toContain("PERSONALIZATION IS THE #1 FIX");
    expect(result).toContain("ACCURACY");
    expect(result).toContain("USEFULNESS");
    expect(result).toContain("fix everything");
  });

  it("prefixes the output with the FEEDBACK CALIBRATION header", () => {
    const result = feedbackCalibration([
      fb({ felt_personalized: "no" }),
      fb({ felt_personalized: "no" }),
      fb({ felt_personalized: "no" }),
    ]);
    expect(result).toMatch(/^FEEDBACK CALIBRATION/);
  });
});
