"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const isSignup = mode === "signup";

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function redirectTarget(fallback: string) {
    if (typeof window === "undefined") return fallback;
    const r = new URLSearchParams(window.location.search).get("redirect");
    return r && r.startsWith("/") ? r : fallback;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        // If email confirmation is disabled, a session is returned immediately.
        if (data.session) {
          router.push(redirectTarget("/onboarding"));
          router.refresh();
        } else {
          setNotice(
            "Account created. Check your email to confirm, then log in. (Tip: the coach can disable email confirmation in Supabase for instant access during the beta.)",
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(redirectTarget("/dashboard"));
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="card space-y-4">
        {isSignup ? (
          <div>
            <label htmlFor="full_name" className="label">
              Full name
            </label>
            <input
              id="full_name"
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input"
              placeholder="Jordan Athlete"
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            placeholder="you@email.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder="••••••••"
          />
          {isSignup ? <p className="hint">At least 6 characters.</p> : null}
        </div>

        {error ? (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-sm text-accent">
            {notice}
          </div>
        ) : null}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading
            ? isSignup
              ? "Creating account…"
              : "Signing in…"
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        {isSignup ? (
          <>
            Already in the beta?{" "}
            <Link href="/login" className="link font-medium">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New participant?{" "}
            <Link href="/signup" className="link font-medium">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
