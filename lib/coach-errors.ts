// Centralized, user-safe translation of coach/Anthropic errors.
//
// The Anthropic SDK throws `Anthropic.APIError` whose `.message` is the full
// raw JSON body (including request_id). Surfacing that straight to the UI is
// what produced the wall-of-JSON "credit balance too low" message in chat.
// Use `friendlyCoachError()` for anything shown to an athlete; it always logs
// the real error server-side so nothing is lost for debugging.

import Anthropic from "@anthropic-ai/sdk";

const GENERIC = "The coach couldn't reply just now. Please try again in a moment.";

/**
 * Map any thrown value into a short, human message safe to show a user, and
 * log the full original error (with request_id when available) server-side.
 *
 * @param err   the caught value
 * @param scope optional label for the server log (e.g. "chat", "auto-respond")
 */
export function friendlyCoachError(err: unknown, scope = "coach"): string {
  // Always log the full thing server-side for debugging.
  if (err instanceof Anthropic.APIError) {
    console.error(
      `[${scope}] Anthropic APIError status=${err.status} request_id=${err.requestID ?? "n/a"}:`,
      err.message,
    );
  } else {
    console.error(`[${scope}] coach generation error:`, err);
  }

  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const raw = (err.message || "").toLowerCase();
    const looksLikeBilling =
      raw.includes("credit balance") ||
      raw.includes("billing") ||
      raw.includes("quota");

    if (status === 402 || (status === 400 && looksLikeBilling)) {
      return "Your coach is temporarily unavailable. (Service billing needs attention — add credits to the Anthropic account.)";
    }
    if (status === 401 || status === 403) {
      return "The coach service isn't configured correctly. (Check the API key.)";
    }
    if (status === 429) {
      return "The coach is busy right now — give it a few seconds and try again.";
    }
    if (status === 500 || status === 502 || status === 503 || status === 529) {
      return "The coach service is having a hiccup — try again shortly.";
    }
    return GENERIC;
  }

  // Our own thrown errors (e.g. "ANTHROPIC_API_KEY is not set",
  // "The coach didn't have a reply") are author-written and safe to show.
  if (err instanceof Error && err.message) {
    if (err.message.includes("ANTHROPIC_API_KEY")) {
      return "The coach service isn't configured correctly. (Missing API key.)";
    }
    return err.message;
  }

  return GENERIC;
}
