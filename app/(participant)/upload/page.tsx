import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { serverToday } from "@/lib/server-date";
import { SOURCE_LABELS } from "@/lib/constants";
import { UploadForm, DeleteScreenshotButton } from "./upload-form";
import { ReviewReadings } from "./review-readings";
import type { UploadedScreenshot } from "@/lib/types";

export const metadata = { title: "Upload screenshots — The Coach" };

// Short, friendly labels for the numbers the OCR pulled off a screenshot.
const READ_LABELS: Record<string, (v: number) => string> = {
  recovery_score: (v) => `Recovery ${v}`,
  hrv_ms: (v) => `HRV ${v}`,
  resting_hr: (v) => `RHR ${v}`,
  sleep_hours: (v) => `Sleep ${v}h`,
  sleep_quality: (v) => `Sleep score ${v}`,
  body_weight_lbs: (v) => `Weight ${v} lb`,
  calories: (v) => `${v} kcal`,
  protein_g: (v) => `P ${v}g`,
  carbs_g: (v) => `C ${v}g`,
  fat_g: (v) => `F ${v}g`,
  water_oz: (v) => `Water ${v} oz`,
};

function readSummary(parsed: Record<string, number | null> | null): string[] {
  if (!parsed) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined) continue;
    const fmt = READ_LABELS[k];
    out.push(fmt ? fmt(v) : `${k} ${v}`);
  }
  return out;
}

export default async function UploadPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const today = await serverToday();

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

  // Pending OCR readings awaiting the athlete's confirmation (not yet applied to
  // a check-in). Only those with at least one value read.
  const pendingReadings = rows
    .filter(
      (r) =>
        r.applied_at == null &&
        r.parsed_json != null &&
        Object.values(r.parsed_json).some((v) => v !== null && v !== undefined),
    )
    .map((r) => ({
      id: r.id,
      source: r.source,
      capture_date: r.capture_date,
      created_at: r.created_at,
      file_name: r.file_name,
      url: urlMap.get(r.storage_path) ?? null,
      parsed: r.parsed_json as Record<string, number | null>,
    }));

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

      <UploadForm dateISO={today} />

      <div className="mt-8">
        <ReviewReadings readings={pendingReadings} />
      </div>

      <div className="mt-8">
        {rows.length === 0 ? (
          <EmptyState
            title="No screenshots yet"
            body="Upload your first one above. A WHOOP recovery or Oura readiness screen is a great place to start."
          />
        ) : (
          (() => {
            // Group by the day the data is for. Today's uploads show by
            // default; anything older collapses under "Earlier uploads".
            const dayOf = (r: UploadedScreenshot) =>
              (r.capture_date ?? r.created_at).slice(0, 10);
            const todays = rows.filter((r) => dayOf(r) === today);
            const earlier = rows.filter((r) => dayOf(r) !== today);

            const Grid = ({ items }: { items: UploadedScreenshot[] }) => (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {items.map((r) => {
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
                        {(() => {
                          const vals = readSummary(r.parsed_json);
                          if (r.parse_status === "pending" || r.parse_status === "processing")
                            return (
                              <div className="mt-1 text-[11px] text-muted-2">Reading numbers…</div>
                            );
                          if (r.parse_status === "error")
                            return (
                              <div className="mt-1 text-[11px] text-danger">Couldn&apos;t read this one</div>
                            );
                          if (vals.length > 0)
                            return (
                              <div className="mt-1 text-[11px] leading-snug text-success">
                                {vals.join(" · ")}
                              </div>
                            );
                          return (
                            <div className="mt-1 text-[11px] text-muted-2">No numbers found</div>
                          );
                        })()}
                        {r.note ? (
                          <div className="mt-1 line-clamp-2 text-[11px] text-muted">{r.note}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );

            return (
              <>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
                  Today — {formatDate(today)} ({todays.length})
                </h2>
                {todays.length === 0 ? (
                  <p className="text-sm text-muted-2">No uploads yet today.</p>
                ) : (
                  <Grid items={todays} />
                )}

                {earlier.length > 0 ? (
                  <details className="mt-6">
                    <summary className="cursor-pointer text-sm font-medium text-muted hover:text-foreground">
                      Earlier uploads ({earlier.length})
                    </summary>
                    <div className="mt-3">
                      <Grid items={earlier} />
                    </div>
                  </details>
                ) : null}
              </>
            );
          })()
        )}
      </div>
    </PageShell>
  );
}
