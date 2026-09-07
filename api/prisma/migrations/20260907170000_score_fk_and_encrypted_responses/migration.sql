-- Two corrections to the Section 4 data model, both flagged at step 3.2.

-- 1. Score had no foreign key to User.
--
-- Section 4 gives Score a bare `userId String` with no relation, unlike
-- HrSignal, Assessment and Alert which all have one. Read as an oversight: with
-- no constraint a Score can reference a person who does not exist, or outlive
-- one who is removed, and nothing in the system would notice. Verified zero
-- orphan rows before adding the constraint.
ALTER TABLE "Score"
  ADD CONSTRAINT "Score_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Assessment.responses: plaintext questionnaire -> AES-256-GCM ciphertext.
--
-- Section 4 types this `Int[]`; Section 9.3 requires field-level AES-256 for it
-- at rest. Both cannot hold — ciphertext does not fit in an integer array. 9.3
-- wins: a person's PHQ-9/GAD-7-style answers are the most sensitive row in the
-- schema, and storing them in the clear would undercut every other privacy
-- control in this system.
--
-- Encryption happens in the application before the value reaches the database
-- (api/src/lib/fieldCrypto.ts), so the key never enters SQL and a database
-- compromise alone does not yield the answers. Layout is
-- 12-byte IV ‖ 16-byte GCM tag ‖ ciphertext.
--
-- NOTE FOR A REAL DEPLOYMENT: this drops the column outright, which is safe
-- here because the only rows were from local end-to-end tests. Against real
-- data the migration would need a backfill — add the column, encrypt each row
-- through the application, then drop the plaintext.
ALTER TABLE "Assessment" DROP COLUMN IF EXISTS "responses";
ALTER TABLE "Assessment" ADD COLUMN "responsesEnc" bytea NOT NULL;

COMMENT ON COLUMN "Assessment"."responsesEnc" IS
  'AES-256-GCM ciphertext of the Likert questionnaire: IV(12) || tag(16) || ct. '
  'Never written in plaintext. Key supplied via AES_KEY, never stored here.';
