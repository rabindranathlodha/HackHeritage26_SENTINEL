import "server-only";

import {
  assessmentAckSchema,
  checkInStatusSchema,
  type CheckInStatus,
} from "@/lib/schemas";

// The only place that talks to the app tier.
//
// `server-only` is load-bearing: importing this from a client component is a
// build error, which is what keeps the shared token out of the browser bundle.
// The browser reaches the app tier exclusively through this app's own proxy
// routes (PWA spec 7), never directly, and never the ML service.

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

function internalHeaders(): HeadersInit {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) throw new Error("INTERNAL_API_TOKEN is not set");
  return { "content-type": "application/json", "x-internal-token": token };
}

export type SubmitAssessment = {
  userId: string;
  responses: number[];
  language: string;
  nlpContribution: number | null;
  /** Reused across retries so a replayed queue item is recorded once. */
  clientSubmissionId: string;
};

export async function submitAssessment(
  input: SubmitAssessment,
): Promise<{ duplicate: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/assessment`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`app tier responded ${res.status}: ${await res.text()}`);
  }

  // Parsed, not trusted. The contract says no score comes back; this is what
  // makes that a guarantee on this side of the boundary too — an unexpected
  // score field would fail the parse rather than be forwarded.
  const ack = assessmentAckSchema.parse(await res.json());
  return { duplicate: ack.duplicate ?? false };
}

export async function getCheckInStatus(userId: string): Promise<CheckInStatus> {
  const res = await fetch(
    `${API_BASE_URL}/api/check-in-status?userId=${encodeURIComponent(userId)}`,
    { headers: internalHeaders(), cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`app tier responded ${res.status}`);
  }
  return checkInStatusSchema.parse(await res.json());
}
