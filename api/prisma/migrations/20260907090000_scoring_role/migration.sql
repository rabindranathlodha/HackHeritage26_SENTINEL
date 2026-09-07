-- SENTINEL — the scoring pipeline's role.
--
-- Computing a SENTINEL score is a system action, not a user action, so it needs
-- privileges no human role has: read any person's HR signals, write a Score,
-- raise an Alert.
--
-- It is deliberately WRITE-ONLY with respect to welfare content. The role can
-- INSERT a Score, an Alert and an Assessment, and can SELECT HrSignal and User,
-- but has NO SELECT on Score, Assessment or Alert. A bug in the scoring path
-- therefore cannot become a data leak: there is nothing for it to read back.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_scoring') THEN
    CREATE ROLE sentinel_scoring NOLOGIN;
  END IF;
END
$$;

-- INHERIT FALSE for the same reason as the four app roles: policies are matched
-- by inherited membership, so an inheriting login would silently collect this
-- role's policies on top of whichever role it had chosen.
GRANT sentinel_scoring TO sentinel_app WITH INHERIT FALSE;
GRANT USAGE ON SCHEMA public TO sentinel_scoring;

-- Reads it needs: the behavioural history to engineer features from, and the
-- user row to check the biometric consent gate.
GRANT SELECT ON "HrSignal" TO sentinel_scoring;
GRANT SELECT ON "User" TO sentinel_scoring;

-- Writes it produces. Note the absence of SELECT on all three.
GRANT INSERT ON "Score" TO sentinel_scoring;
GRANT INSERT ON "Alert" TO sentinel_scoring;
GRANT INSERT ON "Assessment" TO sentinel_scoring;

CREATE POLICY hrsignal_scoring_read ON "HrSignal" FOR SELECT TO sentinel_scoring
  USING (true);

CREATE POLICY user_scoring_read ON "User" FOR SELECT TO sentinel_scoring
  USING (true);

CREATE POLICY score_scoring_insert ON "Score" FOR INSERT TO sentinel_scoring
  WITH CHECK (true);

CREATE POLICY alert_scoring_insert ON "Alert" FOR INSERT TO sentinel_scoring
  WITH CHECK (true);

CREATE POLICY assessment_scoring_insert ON "Assessment" FOR INSERT TO sentinel_scoring
  WITH CHECK (true);

-- The scoring role must never reach the hidden training label either.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '_ground_truth') THEN
    EXECUTE 'REVOKE ALL ON "_ground_truth" FROM sentinel_scoring';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '_physio_signals') THEN
    EXECUTE 'REVOKE ALL ON "_physio_signals" FROM sentinel_scoring';
  END IF;
END
$$;
