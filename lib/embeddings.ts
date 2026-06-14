// Embedding utility — converts text to OpenAI vector embeddings for RAG retrieval.
// Server-only. Requires OPENAI_API_KEY.
// All functions are best-effort and never throw — callers treat null as "no embedding."

import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_client) _client = new OpenAI({ apiKey });
  return _client;
}

/** Embed a single string. Returns null on any failure. */
export async function embedText(text: string): Promise<number[] | null> {
  const client = getClient();
  if (!client || !text.trim()) return null;
  try {
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.trim(),
      dimensions: EMBEDDING_DIMS,
    });
    return res.data[0].embedding;
  } catch {
    return null;
  }
}

/** Batch embed multiple strings in one API call (same order as input). Returns null per item on failure. */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const client = getClient();
  if (!client || texts.length === 0) return texts.map(() => null);
  try {
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts.map((t) => t.trim()),
      dimensions: EMBEDDING_DIMS,
    });
    // API returns results in same order as input
    return res.data.map((d) => d.embedding);
  } catch {
    return texts.map(() => null);
  }
}
