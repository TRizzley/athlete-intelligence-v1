import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppUser, AthleteProfile } from "@/lib/types";

// Returns the current auth user or redirects to /login.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

// Returns the public.users record for the current user (role, name, etc.).
export async function getMyRecord(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return (data as AppUser) ?? null;
}

// Ensures the current user is an admin or redirects.
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!data || data.role !== "admin") redirect("/dashboard");
  return user;
}

// Loads the athlete profile for a user (defaults to current user).
export async function getProfile(userId: string): Promise<AthleteProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("athlete_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as AthleteProfile) ?? null;
}
