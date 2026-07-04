import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in users shouldn't have to click through the marketing page — send
  // them straight to their dashboard whenever they land on the root link.
  if (user) redirect("/dashboard");

  return (
    <div className="mx-auto w-full max-w-content px-4">
      {/* Top bar */}
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-background">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L4.5 12.5h6L11 22l8.5-10.5h-6z" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-tight">The Coach</span>
        </div>
        {user ? (
          <Link href="/dashboard" className="btn-ghost btn-sm">
            Go to dashboard
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost btn-sm">
              Sign in
            </Link>
            <Link href="/signup" className="btn-primary btn-sm">
              Join the beta
            </Link>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="animate-fade-up py-12 sm:py-20">
        <div className="badge mb-5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Private beta · {new Date().getFullYear()}
        </div>
        <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Know exactly how hard to train today —{" "}
          <span className="bg-gradient-to-r from-accent to-foreground bg-clip-text text-transparent">
            based on your body, not averages.
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
          You already collect the data — WHOOP, Oura, Garmin, Apple. A real coach
          reads it every day and gives you one clear decision: push, hold, or
          back off, and exactly why. Vendor-neutral. One coach across every device.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {user ? (
            <Link href="/dashboard" className="btn-primary">
              Open your dashboard
            </Link>
          ) : (
            <>
              <Link href="/signup" className="btn-primary">
                Join the validation beta
              </Link>
              <Link href="/login" className="btn-ghost">
                I already have an account
              </Link>
            </>
          )}
        </div>
        <p className="mt-4 text-xs text-muted-2">
          Beta participants help us prove one thing: that a daily decision can be
          specific enough to feel like it gets you.
        </p>
      </section>

      {/* How it works */}
      <section className="border-t border-border py-14">
        <div className="eyebrow mb-2">How the beta works</div>
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Five minutes a day. A coach in your corner.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            {
              n: "01",
              t: "Log your day",
              d: "A 60-second morning check-in: sleep, recovery, soreness, energy, mood, training, fuel.",
            },
            {
              n: "02",
              t: "Drop in screenshots",
              d: "Snap your WHOOP / Oura / Garmin / Apple screens. Your coach sees the same data you do.",
            },
            {
              n: "03",
              t: "Get your daily call",
              d: "A specific recommendation, a prediction for tomorrow, and the reasoning behind it.",
            },
          ].map((s) => (
            <div key={s.n} className="card">
              <div className="text-sm font-semibold text-accent">{s.n}</div>
              <h3 className="mt-2 font-semibold text-foreground">{s.t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The honest frame */}
      <section className="border-t border-border py-14">
        <div className="card bg-surface-2">
          <div className="eyebrow mb-2">What we&apos;re testing</div>
          <p className="text-pretty text-lg leading-relaxed text-foreground">
            “Damn, it gets me.”
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            That&apos;s the whole experiment. After each coaching response you&apos;ll tell us
            whether it felt accurate, whether it felt personal, whether the
            recommendation was useful, whether the prediction came true — and
            whether you&apos;d pay to keep it. Your honest answers decide what we build next.
          </p>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-2">
        The Coach — Sprint V1 validation. Not a medical device; not medical advice.
      </footer>
    </div>
  );
}
