// Barrel re-export — imports from this file still work unchanged.
// Prefer importing from the specific module for new code:
//   coach-types      — CoachDraft, CoachContext, ChatTurn, WorkoutLogBrief, ProgramContext
//   coach-context    — feedbackCalibration, buildContextText
//   coach-draft      — generateCoachDraft
//   coach-chat       — generateCoachChatReply
//   coach-workout    — generateWorkoutReview, WorkoutReview, MorningPredictionResult
//   coach-milestones — generateMilestoneReport, MilestoneTier
//   coach-memory     — distillMemoryFromChat, distillMemoryFromCheckin, DistilledNote
//   coach-predictions — scorePredictionOutcome, PredictionOutcomeValue, PredictionScore

export type { CoachDraft, WorkoutLogBrief, ProgramContext, CoachContext, ChatTurn } from "./coach-types";
export { feedbackCalibration } from "./coach-context";
export { generateCoachDraft } from "./coach-draft";
export { generateCoachChatReply } from "./coach-chat";
export type { WorkoutReview, MorningPredictionResult } from "./coach-workout";
export { generateWorkoutReview } from "./coach-workout";
export type { MilestoneTier } from "./coach-milestones";
export { generateMilestoneReport } from "./coach-milestones";
export type { DistilledNote } from "./coach-memory";
export { distillMemoryFromChat, distillMemoryFromCheckin } from "./coach-memory";
export type { PredictionOutcomeValue, PredictionScore } from "./coach-predictions";
export { scorePredictionOutcome } from "./coach-predictions";
