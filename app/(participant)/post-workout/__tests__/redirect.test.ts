// B5.2 — the /post-workout tab was merged into the workout save flow; the
// route survives only as bookmark insurance and must redirect to /workout.
import { describe, it, expect, vi } from "vitest";
import PostWorkoutPage from "../page";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("/post-workout (removed tab)", () => {
  it("redirects to /workout instead of rendering the old form", () => {
    PostWorkoutPage();

    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/workout");
  });
});
