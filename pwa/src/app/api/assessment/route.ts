import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { submitAssessment } from "@/lib/api";
import { checkInSubmissionSchema } from "@/lib/schemas";

// POST /api/assessment — this app's own proxy (PWA spec 7).
//
// The browser calls only this. It exists to do two things the browser must not:
// hold the shared token, and decide who the submission belongs to.
//
// The user id comes from the session, never from the request body. If it came
// from the body, anyone with a session could file a check-in as somebody else.

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  const parsed = checkInSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid submission", detail: parsed.error.issues },
      { status: 422 },
    );
  }

  let duplicate = false;
  try {
    ({ duplicate } = await submitAssessment({
      userId,
      responses: parsed.data.responses,
      language: parsed.data.language,
      nlpContribution: parsed.data.nlpContribution,
      clientSubmissionId: parsed.data.clientId,
    }));
  } catch (error) {
    console.error("assessment submission failed", error);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  // Nothing but an acknowledgement. No score exists on this side to leak.
  // `duplicate` tells the outbox a replay landed on an already-recorded
  // submission, which is a success for its purposes, not an error.
  return NextResponse.json({ ok: true, duplicate });
}
