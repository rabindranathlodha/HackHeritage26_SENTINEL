-- Idempotency for queued check-ins (PWA spec 6).
--
-- Offline submissions are retried until they succeed. Without a key the device
-- cannot tell "the server never got it" from "the reply never got back", so a
-- flaky connection would file the same week's check-in two or three times —
-- and every duplicate produces another Score and possibly another alert for a
-- welfare officer to work through. The person would have done nothing wrong.
--
-- The key is generated on the device before the first attempt and reused for
-- every retry of that submission.

ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "clientSubmissionId" text;

-- Partial, so rows predating this column (and any future server-side insert
-- with no client key) are unaffected rather than colliding on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS assessment_client_submission_unique
  ON "Assessment" ("userId", "clientSubmissionId")
  WHERE "clientSubmissionId" IS NOT NULL;

COMMENT ON COLUMN "Assessment"."clientSubmissionId" IS
  'Device-generated UUID identifying one submission across retries. Unique per '
  'user so a queued check-in replayed after a dropped connection is recorded '
  'once. Not an identifier of the person or the device.';
