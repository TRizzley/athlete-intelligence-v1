"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./sign-out-button";

const LINKS = [
  { href: "/checkin", label: "Check-in" },
  { href: "/dashboard", label: "Today" },
  { href: "/workout", label: "Workout" },
  { href: "/post-workout", label: "Post-workout" },
  { href: "/coach", label: "Coach" },
];

export function SiteNav({
  name,
  isAdmin,
}: {
  name?: string | null;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-wide items-center justify-between gap-3 px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Logo />
          <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:inline">
            The Coach
          </span>
        </Link>

        <nav className="flex items-center gap-1 rounded-full border border-border bg-surface/70 p-1">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                  active
                    ? "bg-surface-3 text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {isAdmin ? (
            <Link
              href="/admin"
              className="hidden rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 sm:inline-flex"
            >
              Coach view
            </Link>
          ) : null}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-background">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L4.5 12.5h6L11 22l8.5-10.5h-6z" />
      </svg>
    </span>
  );
}
