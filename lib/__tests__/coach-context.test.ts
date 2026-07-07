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

describe("buildContextText — workout patterns", () => {
  it("renders the patterns section with its pre-computed summary line", () => {
    const text = buildContextText(
      ctx({
        selfEvals: [
          selfEval({ workout_date: "2026-07-03", day_name: "Leg day", rpe: 8 }),
          selfEval({ workout_date: "2026-07-01", day_name: "Leg day", rpe: 8 }),
        ],
      }),
    );

    expect(text).toContain("WORKOUT PATTERNS");
    expect(text).toContain('"peak_types":["Leg day"]');
    expect(text).toContain('"avgRpe": 8');
    expect(text).toContain('"trend": "stable"');
    // Right after the self-evals it summarizes.
    expect(text.indexOf("ATHLETE SELF-EVALS")).toBeLessThan(
      text.indexOf("WORKOUT PATTERNS"),
    );
  });

  it("omits the section when no workout type has enough evals for signal", () => {
    const text = buildContextText(ctx({ selfEvals: [selfEval()] }));

    expect(text).toContain("ATHLETE SELF-EVALS");
    expect(text).not.toContain("WORKOUT PATTERNS");
  });

  it("omits the section when all evals fall outside the 30-day window", () => {
    const stale = [
      selfEval({ workout_date: "2026-04-01", day_name: "Leg day", rpe: 8 }),
      selfEval({ workout_date: "2026-04-03", day_name: "Leg day", rpe: 8 }),
    ];

    expect(buildContextText(ctx({ selfEvals: stale }))).not.toContain(
      "WORKOUT PATTERNS",
    );
  });
});

describe("buildContextText — suggested focus", () => {
  // A peak (Leg day) and a struggle (Upper 1), enough evals for both buckets.
  const withSignal = [
    selfEval({ workout_date: "2026-07-03", day_name: "Leg day", rpe: 9 }),
    selfEval({ workout_date: "2026-07-02", day_name: "Upper 1", rpe: 4 }),
    selfEval({ workout_date: "2026-07-01", day_name: "Leg day", rpe: 7 }),
    selfEval({ workout_date: "2026-06-30", day_name: "Upper 1", rpe: 5 }),
  ];

  it("renders the pre-computed focus directive right after the patterns section", () => {
    const text = buildContextText(ctx({ selfEvals: withSignal }));

    expect(text).toContain("SUGGESTED FOCUS");
    expect(text).toContain('"push_type":"Leg day"');
    expect(text).toContain('"pull_back_type":"Upper 1"');
    expect(text).toContain('"confidence":"low"');
    expect(text.indexOf("WORKOUT PATTERNS")).toBeLessThan(
      text.indexOf("SUGGESTED FOCUS"),
    );
  });

  it("omits the section when patterns exist but nothing is peak or struggle", () => {
    const middling = [
      selfEval({ workout_date: "2026-07-03", day_name: "Push", rpe: 6 }),
      selfEval({ workout_date: "2026-07-01", day_name: "Push", rpe: 6 }),
    ];
    const text = buildContextText(ctx({ selfEvals: middling }));

    expect(text).toContain("WORKOUT PATTERNS");
    expect(text).not.toContain("SUGGESTED FOCUS");
  });

  it("never mentions calendar days in the rendered focus block", () => {
    const text = buildContextText(ctx({ selfEvals: withSignal }));
    const focusBlock = text.slice(text.indexOf("SUGGESTED FOCUS"));
    const nextSection = focusBlock.indexOf("\n\n");
    const block =
      nextSection === -1 ? focusBlock : focusBlock.slice(0, nextSection);

    expect(block).not.toMatch(
      /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
    );
  });
});

describe("buildContextText — temporal knowledge graph", () => {
  const summary = {
    window: { daysSpanned: 42, from: "2026-05-23", to: "2026-07-04" },
    frequency: {
      totalSessions: 22,
      sessionsPerWeek: 3.7,
      consistency: "consistent",
    },
    typeBreakdown: {
      strength: { count: 12, avgIntensity: 7.4, trend: "stable" as const },
    },
    volumeArc: [
      { weekLabel: "Week 1-4", totalTonnage: 91725, trend: "insufficient_data" as const },
      { weekLabel: "Week 5-8", totalTonnage: 54325, trend: "declining" as const },
    ],
    fatigueSignal: { detected: true, when: "Week 5-8", severity: "mild" as const },
    restRhythm: {
      avgGapDays: 1.9,
      maxGapDays: 4,
      gapsOver3d: 1,
      inference: "consistent" as const,
    },
    seasonality: null,
  };

  it("renders the section when a temporal summary is present", () => {
    const text = buildContextText(ctx({ temporalSummary: summary }));

    expect(text).toContain("TEMPORAL KNOWLEDGE GRAPH");
    expect(text).toContain("last 42 days");
    expect(text).toContain('"fatigue_signal"');
    expect(text).toContain('"volume_trend": "declining"');
  });

  it("omits the section when absent or empty", () => {
    expect(buildContextText(ctx())).not.toContain("TEMPORAL KNOWLEDGE GRAPH");
    const empty = {
      ...summary,
      window: { daysSpanned: 0, from: "", to: "" },
    };
    expect(buildContextText(ctx({ temporalSummary: empty }))).not.toContain(
      "TEMPORAL KNOWLEDGE GRAPH",
    );
  });
});
