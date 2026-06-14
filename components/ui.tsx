import Link from "next/link";
import type { ReactNode } from "react";
import { initials } from "@/lib/format";

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function PageShell({
  children,
  width = "content",
}: {
  children: ReactNode;
  width?: "app" | "content" | "wide";
}) {
  const max =
    width === "app" ? "max-w-app" : width === "wide" ? "max-w-wide" : "max-w-content";
  return (
    <div className={`mx-auto w-full ${max} px-4 py-6 sm:py-10`}>{children}</div>
  );
}

export function SectionHeading({
  title,
  subtitle,
  eyebrow,
  action,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  required,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required ? <span className="text-accent"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6m3 6V7m3 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges, pills, avatars
// ---------------------------------------------------------------------------

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}

export function ConfidenceBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-2">—</span>;
  const map: Record<string, string> = {
    low: "bg-surface-3 text-muted",
    medium: "bg-warning/15 text-warning",
    high: "bg-success/15 text-success",
  };
  return (
    <span className={`pill ${map[value] ?? "bg-surface-3 text-muted"}`}>
      {value} confidence
    </span>
  );
}

export function StatusPill({ value }: { value: string }) {
  const sent = value === "sent";
  return (
    <span
      className={`pill ${sent ? "bg-success/15 text-success" : "bg-surface-3 text-muted"}`}
    >
      {sent ? "Sent" : "Draft"}
    </span>
  );
}

// Layer-1 coach self-grade: performance prediction vs. the actual workout log.
// Admin-only; prefixed "Self:" so it's never confused with the check-in outcome.
export function SelfGradeBadge({ value }: { value: string | null }) {
  if (!value) return null;
  const map: Record<string, string> = {
    accurate: "bg-success/15 text-success",
    slightly_off: "bg-warning/15 text-warning",
    missed: "bg-danger/15 text-danger",
  };
  const label: Record<string, string> = {
    accurate: "Accurate",
    slightly_off: "Slightly Off",
    missed: "Missed",
  };
  return (
    <span className={`pill ${map[value] ?? "bg-surface-3 text-muted-2"}`}>
      Self: {label[value] ?? value}
    </span>
  );
}

export function OutcomeBadge({ value }: { value: string | null }) {
  if (!value) return <span className="pill bg-surface-3 text-muted-2">Not scored</span>;
  const map: Record<string, string> = {
    came_true: "bg-success/15 text-success",
    partially: "bg-warning/15 text-warning",
    false: "bg-danger/15 text-danger",
    too_early: "bg-surface-3 text-muted",
    unknown: "bg-surface-3 text-muted-2",
  };
  const label: Record<string, string> = {
    came_true: "Came true",
    partially: "Partial",
    false: "Missed",
    too_early: "Too early",
    unknown: "Unknown",
  };
  return <span className={`pill ${map[value]}`}>{label[value] ?? value}</span>;
}

export function Avatar({
  name,
  email,
  size = "md",
}: {
  name?: string | null;
  email?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  return (
    <div
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-2 font-semibold text-accent`}
    >
      {initials(name, email)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric displays
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="card-tight">
      <div className="stat-label">{label}</div>
      <div className="stat-value mt-1">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-2">{hint}</div> : null}
    </div>
  );
}

// A labeled percentage bar with a sensible color threshold.
export function MetricBar({
  label,
  value,
  sample,
  goodAt = 60,
}: {
  label: string;
  value: number | null;
  sample?: string;
  goodAt?: number;
}) {
  const has = value !== null && value !== undefined;
  const v = has ? Math.max(0, Math.min(100, value)) : 0;
  const color =
    !has ? "bg-surface-3" : v >= goodAt ? "bg-success" : v >= goodAt * 0.66 ? "bg-warning" : "bg-danger";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm tabular-nums text-muted">
          {has ? `${Math.round(value)}%` : "—"}
          {sample ? <span className="ml-1 text-xs text-muted-2">({sample})</span> : null}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

// A read-only field display (label over value) for review pages.
export function DataPoint({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-2">
        {label}
      </div>
      <div className={`mt-0.5 text-sm ${accent ? "font-semibold text-accent" : "text-foreground"}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {children}
    </Link>
  );
}

// Renders multi-line text preserving line breaks; falls back to a muted dash.
export function Prose({ text }: { text: string | null | undefined }) {
  if (!text || !text.trim()) return <span className="text-muted-2">—</span>;
  return <p className="whitespace-pre-wrap leading-relaxed text-foreground">{text}</p>;
}
