import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Join the beta — The Coach" };

export default function SignupPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-app flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-8 flex items-center justify-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-strong text-background">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L4.5 12.5h6L11 22l8.5-10.5h-6z" />
          </svg>
        </span>
        <span className="text-base font-semibold tracking-tight text-foreground">The Coach</span>
      </Link>

      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Join the beta</h1>
        <p className="mt-1 text-sm text-muted">
          Two minutes to set up. Then your coach reads your data daily.
        </p>
      </div>

      <AuthForm mode="signup" />
    </div>
  );
}
