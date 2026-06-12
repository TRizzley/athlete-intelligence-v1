"use client";

// Polls for OCR completion when screenshots are still being read.
// Mounted by the upload page when any screenshot has parse_status =
// "pending" or "processing". Calls router.refresh() every 3 seconds
// until the parent server component re-renders without processing rows
// (at which point this component is no longer mounted).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 3000;

export function OcrPoller() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null; // renders nothing; side-effect only
}
