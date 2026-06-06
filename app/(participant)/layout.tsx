import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "@/components/site-nav";

// Shared chrome for all participant-facing pages. Also enforces that a user
// has completed onboarding before they can use the daily loop.
export default async function ParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: record } = await supabase
    .from("users")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const { data: profile } = await supabase
    .from("athlete_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    if (record?.role === "admin") redirect("/admin");
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen">
      <SiteNav name={record?.full_name} isAdmin={record?.role === "admin"} />
      <main>{children}</main>
    </div>
  );
}
