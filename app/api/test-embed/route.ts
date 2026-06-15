import { NextResponse } from "next/server";
import { embedText } from "@/lib/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const embedding = await embedText("test note for RAG");

  if (!embedding) {
    return NextResponse.json({ ok: false, error: "embedText returned null" }, { status: 500 });
  }

  // Try inserting a test note with embedding directly
  const admin = createAdminClient();
  const { data: users } = await admin.from("users").select("id").limit(1);
  const userId = users?.[0]?.id;

  if (!userId) {
    return NextResponse.json({ ok: true, embeddingDims: embedding.length, note: "no user to test insert" });
  }

  const { error } = await admin.from("athlete_memory_notes").insert({
    user_id: userId,
    category: "test",
    note: "RAG test note — delete me",
    created_by: userId,
    embedding: `[${embedding.join(",")}]`,
  });

  return NextResponse.json({
    ok: !error,
    embeddingDims: embedding.length,
    insertError: error?.message ?? null,
  });
}
