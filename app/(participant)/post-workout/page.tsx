import { redirect } from "next/navigation";

// The standalone post-workout check-in was merged into the workout save flow
// (B5.1 — saveSession writes the eval + check-in columns in one save), and the
// tab was removed in B5.2. This route stays as bookmark insurance: anyone
// landing on an old /post-workout link gets the merged flow instead of a 404.
// post-workout-form.tsx and actions.ts remain in place as dead code pending a
// separate cleanup decision.
export default function PostWorkoutPage() {
  redirect("/workout");
}
