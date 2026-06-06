import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, EmptyState } from "@/components/ui";
import { todayISO, formatDate } from "@/lib/format";
import { SOURCE_LABELS } from "@/lib/constants";
import { UploadForm, DeleteScreenshotButton } from "./upload-form";
import type { UploadedScreenshot } from "@/lib/types";

export const metadata = { title: "Upload screenshots — The Coach" };

export default async function UploadPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: shots } = await supabase
    .from("uploaded_screenshots")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(48);

  const rows = (shots as UploadedScreenshot[]) ?? [];

  // Batch-sign URLs for thumbnails.
  const urlMap = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed } = await supabase.storage
      .from("screenshots")
      .createSignedUrls(
        rows.map((r) => r.storage_path),
        60 * 60,
      );
    signed?.forEach((s) => {
      if (s.signedUrl && s.path) urlMap.set(s.path, s.signedUrl);
    });
  }

  return (
    <PageShell width="content">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Screenshots</div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Show your coach what you see
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Snap your WHOOP, Oura, Garmin, Apple, or nutrition screens. This is how
          your coach sees the same numbers you do — during the beta we read them by hand.
        </p>
      </div>

      <UploadForm dateISO={todayISO()} />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
          Your uploads ({rows.length})
        </h2>

        {rows.length === 0 ? (
          <EmptyState
            title="No screenshots yet"
            body="Upload your first one above. A WHOOP recovery or Oura readiness screen is a great place to start."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rows.map((r) => {
              const url = urlMap.get(r.storage_path);
              return (
                <div
                  key={r.id}
                  className="group relative overflow-hidden rounded-xl border border-border bg-surface"
                >
                  <div className="absolute right-2 top-2 z-10 opacity-0 transition group-hover:opacity-100">
                    <DeleteScreenshotButton id={r.id} />
                  </div>
                  <a href={url} target="_blank" rel="noreferrer" className="block">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={SOURCE_LABELS[r.source] ?? r.source}
                        className="aspect-[3/4] w-full bg-surface-2 object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[3/4] w-full items-center justify-center bg-surface-2 text-xs text-muted-2">
                        preview unavailable
                      </div>
                    )}
                  </a>
                  <div className="px-2.5 py-2">
                    <div className="text-xs font-semibold text-foreground">
                      {SOURCE_LABELS[r.source] ?? r.source}
                    </div>
                    <div className="text-[11px] text-muted-2">
                      {r.capture_date ? formatDate(r.capture_date) : formatDate(r.created_at)}
                    </div>
                    {r.note ? (
                      <div className="mt-1 line-clamp-2 text-[11px] text-muted">{r.note}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
