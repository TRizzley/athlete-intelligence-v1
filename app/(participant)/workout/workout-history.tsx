"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { deleteSession } from "./actions";
import type { WorkoutSession, WorkoutSetLog } from "@/lib/types";

type ExerciseGroup = {
  name: string;
  muscle: string | null;
  superset: string | null;
  sets: WorkoutSetLog[];
};

function groupLogs(logs: WorkoutSetLog[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = [];
  for (const l of logs) {
    let g = groups.find((x) => x.name === l.exercise_name);
    if (!g) {
      g = { name: l.exercise_name, muscle: l.muscle_group, superset: l.superset_group, sets: [] };
      groups.push(g);
    }
    g.sets.push(l);
  }
  return groups;
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const [groups, setGroups] = useState<ExerciseGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!loaded && !loading) {
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("workout_set_logs")
      .select("*")
      .eq("session_id", sessionId)
      .order("position", { ascending: true })
      .then(({ data }) => {
        setGroups(groupLogs((data as WorkoutSetLog[]) ?? []));
        setLoaded(true);
        setLoading(false);
      });
  }

  if (loading || !loaded) {
    return <div className="mt-3 text-xs text-muted-2 animate-pulse">Loading sets…</div>;
  }

  if (!groups || groups.length === 0) {
    return <div className="mt-3 text-xs text-muted-2">No sets logged.</div>;
  }

  return (
    <div className="mt-3 space-y-3">
      {groups.map((g) => (
        <div
          key={g.name}
          className={`rounded-lg bg-surface-2 px-3 py-2.5 ${g.superset ? "border-l-2 border-l-accent" : ""}`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">{g.name}</span>
            <div className="flex gap-1.5">
              {g.superset && <span className="pill bg-accent/15 text-accent text-[10px]">Superset</span>}
              {g.muscle && <span className="pill bg-surface-3 text-muted text-[10px]">{g.muscle}</span>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="grid grid-cols-[2rem_1fr_1fr] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-2">
              <span>Set</span>
              <span>Weight</span>
              <span>Reps</span>
            </div>
            {g.sets.map((s) => (
              <div key={s.id} className="grid grid-cols-[2rem_1fr_1fr] gap-2 text-xs tabular-nums">
                <span className="font-semibold text-muted">{s.set_number}</span>
                <span className="text-foreground">{s.weight != null ? `${s.weight} lb` : "—"}</span>
                <span className="text-foreground">{s.reps != null ? s.reps : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const INITIAL_VISIBLE = 5;

export function WorkoutHistory({ history: initial }: { history: WorkoutSession[] }) {
  const [sessions, setSessions] = useState(initial);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggleItem(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDeleteClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setConfirmId(id);
  }

  function handleConfirmDelete(id: string) {
    startTransition(async () => {
      const result = await deleteSession(id);
      if (result.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      setConfirmId(null);
    });
  }

  const visible = showAll ? sessions : sessions.slice(0, INITIAL_VISIBLE);
  const hiddenCount = sessions.length - INITIAL_VISIBLE;

  return (
    <div className="mt-10">
      {/* Section header with collapse toggle */}
      <button
        onClick={() => setSectionOpen((o) => !o)}
        className="mb-3 flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">History</h2>
        <span
          className="text-muted-2 transition-transform duration-200"
          style={{ transform: sectionOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {sectionOpen && (
        <>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-2">No workouts logged yet.</p>
          ) : (
            <div className="space-y-2">
              {visible.map((s) => {
                const isOpen = expandedIds.has(s.id);
                const isConfirming = confirmId === s.id;

                return (
                  <div
                    key={s.id}
                    className="card-tight overflow-hidden transition hover:border-border-strong"
                  >
                    {/* Row header */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleItem(s.id)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">
                            {s.day_name ?? "Workout"}
                          </div>
                          {s.notes ? (
                            <div className="mt-0.5 line-clamp-1 text-xs text-muted">{s.notes}</div>
                          ) : null}
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-2">
                          {formatDate(s.session_date)}
                          <svg
                            className="h-3.5 w-3.5 transition-transform duration-200"
                            style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </span>
                      </button>

                      {/* Delete button */}
                      {!isConfirming ? (
                        <button
                          onClick={(e) => handleDeleteClick(e, s.id)}
                          className="ml-1 shrink-0 rounded p-1 text-muted-2 transition hover:text-red-500"
                          title="Delete workout"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      ) : (
                        <div className="ml-1 flex shrink-0 items-center gap-1.5">
                          <span className="text-xs text-muted">Delete?</span>
                          <button
                            onClick={() => handleConfirmDelete(s.id)}
                            disabled={isPending}
                            className="rounded px-2 py-0.5 text-xs font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded px-2 py-0.5 text-xs text-muted transition hover:text-foreground"
                          >
                            No
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Expanded detail */}
                    {isOpen && <SessionDetail sessionId={s.id} />}
                  </div>
                );
              })}

              {/* Show more / less */}
              {sessions.length > INITIAL_VISIBLE && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-1 w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted transition hover:border-border-strong hover:text-foreground"
                >
                  {showAll
                    ? "Show less"
                    : `Show ${hiddenCount} more workout${hiddenCount !== 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
