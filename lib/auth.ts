import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
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
// Fast path: checks JWT app_metadata.role (populated by DB trigger -- no second round-trip).
// Slow path: falls back to a users table query for accounts without the JWT claim set.
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if ((user.app_metadata as Record<string, unknown>)?.role === "admin") return user;
  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!data || data.role !== "admin") redirect("/dashboard");
  return user;
}

// API-safe admin check -- returns the authenticated User or null. Never redirects.
// Use this in API route handlers instead of requireAdmin(), which is for page layouts.
// Same fast/slow path: JWT app_metadata first, DB fallback for older accounts.
export async function checkAdmin(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if ((user.app_metadata as Record<string, unknown>)?.role === "admin") return user;
  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return data?.role === "admin" ? user : null;
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
