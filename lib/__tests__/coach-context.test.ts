import { describe, it, expect } from "vitest";
import { buildContextText } from "../coach-context";
import type { CoachContext, SelfEvalBrief } from "../coach-types";

// Minimal context — only the required CoachContext fields, everything empty.
function ctx(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    athleteName: "Test Athlete",
    today: "2026-07-04",
    profile: null,
    latestCheckin: null,
    recentCheckins: [],
    screenshots: [],
    memoryNotes: [],
    previousResponses: [],
    predictions: [],
    feedback: [],
    ...overrides,
  };
}

function selfEval(overrides: Partial<SelfEvalBrief> = {}): SelfEvalBrief {
  return {
    workout_date: "2026-07-03",
    day_name: "Push",
    rpe: 7,
    feedback: "felt strong",
    ...overrides,
  };
}

describe("buildContextText — athlete self-evals", () => {
  it("renders the self-evals section with RPE and the athlete's words", () => {
    const text = buildContextText(ctx({ selfEvals: [selfEval()] }));

    expect(text).toContain("ATHLETE SELF-EVALS");
    expect(text).toContain('"rpe_1to10": 7');
    expect(text).toContain('"their_words": "felt strong"');
    expect(text).toContain('"workout_date": "2026-07-03"');
    expect(text).toContain('"day": "Push"');
  });

  it("renders the pre-computed summary line above the eval rows", () => {
    const text = buildContextText(
      ctx({
        selfEvals: [
          selfEval({ rpe: 8, feedback: "felt strong" }),
          selfEval({ workout_date: "2026-07-01", rpe: 6, feedback: "flat" }),
        ],
      }),
    );

    expect(text).toContain('SUMMARY: {"avg_rpe_last_5":7,"rpe_trend":"up","evals_logged":2,"latest_words":"felt strong"}');
  });

  it("omits the section when there are no self-evals", () => {
    expect(buildContextText(ctx({ selfEvals: [] }))).not.toContain(
      "ATHLETE SELF-EVALS",
    );
    expect(buildContextText(ctx())).not.toContain("ATHLETE SELF-EVALS");
  });

  it("drops null feedback instead of rendering it", () => {
    const text = buildContextText(
      ctx({ selfEvals: [selfEval({ feedback: null })] }),
    );

    expect(text).toContain('"rpe_1to10": 7');
    expect(text).not.toContain("their_words");
  });

  it("keeps evals in the order given (newest first)", () => {
    const text = buildContextText(
      ctx({
        selfEvals: [
          selfEval({ workout_date: "2026-07-03", rpe: 9 }),
          selfEval({ workout_date: "2026-07-01", rpe: 5 }),
        ],
      }),
    );

    expect(text.indexOf("2026-07-03")).toBeLessThan(
      text.indexOf("2026-07-01"),
    );
  });

  it("renders self-evals right after logged workouts so dates line up", () => {
    const text = buildContextText(
      ctx({
        recentWorkouts: [
          { session_date: "2026-07-03", day_name: "Push", notes: null, sets: [] },
        ],
        selfEvals: [selfEval()],
      }),
    );

    expect(text.indexOf("LOGGED WORKOUTS")).toBeLessThan(
      text.indexOf("ATHLETE SELF-EVALS"),
    );
  });
});
