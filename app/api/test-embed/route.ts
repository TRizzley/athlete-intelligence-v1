import { NextResponse } from "next/server";
import OpenAI from "openai";

export async function GET() {
  const key = process.env.OPENAI_API_KEY;

  // Step 1: is the key present?
  if (!key) {
    return NextResponse.json({ step: 1, error: "OPENAI_API_KEY is missing from env" }, { status: 500 });
  }

  // Step 2: can we call the API directly?
  try {
    const client = new OpenAI({ apiKey: key });
    const res = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: "test",
      dimensions: 1536,
    });
    return NextResponse.json({
      ok: true,
      keyPrefix: key.slice(0, 12),
      dims: res.data[0].embedding.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ step: 2, error: msg, keyPrefix: key.slice(0, 12) }, { status: 500 });
  }
}
