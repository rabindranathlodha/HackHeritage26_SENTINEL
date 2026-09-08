-- Letting a person change their own consent (PWA spec 3.8, principle 4).
--
-- Consent is supposed to be "explicit and reversible ... toggleable off at any
-- time". It was neither, in the only place that counts: sentinel_personnel held
-- SELECT on "User" and nothing more, so the biometric flag could be set by an
-- administrator and never unset by the person it describes. A settings screen
-- would have been a control that did not control anything.
--
-- The grant is COLUMN-SCOPED, which is the whole design. A table-wide UPDATE
-- would let someone set their own role to COMMANDER or reassign their welfare
-- officer — turning a consent toggle into privilege escalation. Postgres checks
-- column privileges independently of row policies, so the two together say:
-- this person, this row, this column, nothing else.

GRANT UPDATE ("biometricConsent") ON "User" TO sentinel_personnel;

-- USING chooses which rows may be updated; WITH CHECK constrains what the row
-- may become. Both are needed: without WITH CHECK a person could update their
-- own row and set its id to someone else's.
CREATE POLICY user_self_consent ON "User" FOR UPDATE TO sentinel_personnel
  USING (id = sentinel_current_user_id())
  WITH CHECK (id = sentinel_current_user_id());

COMMENT ON COLUMN "User"."biometricConsent" IS
  'Opt-in for the wellness signal (Model C). Default false. The person may set '
  'and unset it themselves; the scoring pipeline reads it from here and never '
  'from a request body, so revoking it takes effect on the next assessment '
  'without anything else having to cooperate.';
