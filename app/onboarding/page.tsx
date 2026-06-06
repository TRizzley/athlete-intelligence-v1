import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { OnboardingForm } from "./onboarding-form";
import type { AthleteProfile } from "@/lib/types";

export const metadata = { title: "Set up your athlete profile — The Coach" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("athlete_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: record } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <PageShell width="content">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Step 1 · Athlete profile</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tell your coach who you are
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-muted">
            This is the foundation for every recommendation. The more honest and
            specific, the sharper your daily call. You can edit it anytime.
          </p>
        </div>
        <SignOutButton />
      </div>

      <OnboardingForm
        profile={(profile as AthleteProfile) ?? null}
        defaultName={record?.full_name ?? ""}
      />
    </PageShell>
  );
}
