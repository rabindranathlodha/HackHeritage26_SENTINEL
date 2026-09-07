-- SENTINEL — k-anonymity, cohort aggregates, and escalation support.
--
-- Spec 9.1 requires that a sub-threshold cohort be impossible to read "by
-- calling the API directly". So the threshold is applied inside the function
-- that reads the data, as the table owner, and there is no parameter that
-- disables it. An application bug cannot widen this; only a migration can.

-- The threshold itself
--
-- Held in a table rather than an env var so that SQL and the application read
-- the SAME number. K_ANONYMITY_THRESHOLD in .env seeds this via
-- scripts/bootstrap_db.sh; the value here is what actually enforces.
CREATE TABLE IF NOT EXISTS "PrivacyConfig" (
  id                    boolean PRIMARY KEY DEFAULT true,
  "kAnonymityThreshold" integer NOT NULL CHECK ("kAnonymityThreshold" >= 2),
  "trendDelta"          double precision NOT NULL DEFAULT 10.0,
  "trendWindow"         integer NOT NULL DEFAULT 3,
  CONSTRAINT single_row CHECK (id)
);

INSERT INTO "PrivacyConfig" (id, "kAnonymityThreshold")
VALUES (true, 10)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON "PrivacyConfig" FROM PUBLIC;

CREATE OR REPLACE FUNCTION sentinel_k_threshold() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT "kAnonymityThreshold" FROM "PrivacyConfig" WHERE id
$fn$;

GRANT EXECUTE ON FUNCTION sentinel_k_threshold() TO
  sentinel_commander, sentinel_welfare_officer, sentinel_scoring, sentinel_admin;

-- Cohort aggregates with k-anonymity baked in
--
-- Returns ONE ROW PER COHORT. A cohort with fewer than k members comes back
-- with refused = true and every aggregate column NULL — never a partial figure,
-- never a rounded one. There is no argument that turns this off.
--
-- Revealing that a cohort exists but is suppressed is intentional: spec 9.1's
-- refusal object already discloses exactly that.
CREATE OR REPLACE FUNCTION sentinel_cohort_summary(
  p_unit_id text DEFAULT NULL,
  p_band text DEFAULT NULL
)
RETURNS TABLE (
  unit_id           text,
  refused           boolean,
  reason            text,
  n                 bigint,
  low_count         bigint,
  moderate_count    bigint,
  elevated_count    bigint,
  priority_count    bigint,
  mean_score        numeric
)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  k integer := sentinel_k_threshold();
BEGIN
  RETURN QUERY
  WITH latest AS (
    -- One score per person: the most recent. Counting every historical score
    -- would let a cohort clear k on repeat measurements of a handful of people.
    SELECT DISTINCT ON (s."userId") s."userId", s.band, s."sentinelScore"
    FROM "Score" s
    ORDER BY s."userId", s."computedAt" DESC
  ),
  joined AS (
    SELECT u."unitId", l.band, l."sentinelScore"
    FROM latest l
    JOIN "User" u ON u.id = l."userId"
    WHERE (p_unit_id IS NULL OR u."unitId" = p_unit_id)
      AND (p_band IS NULL OR l.band::text = p_band)
  ),
  grouped AS (
    SELECT j."unitId" AS unit_id,
           count(*) AS n,
           count(*) FILTER (WHERE j.band = 'LOW') AS low_count,
           count(*) FILTER (WHERE j.band = 'MODERATE') AS moderate_count,
           count(*) FILTER (WHERE j.band = 'ELEVATED') AS elevated_count,
           count(*) FILTER (WHERE j.band = 'PRIORITY_REVIEW') AS priority_count,
           round(avg(j."sentinelScore")::numeric, 2) AS mean_score
    FROM joined j
    GROUP BY j."unitId"
  )
  SELECT g.unit_id,
         g.n < k AS refused,
         CASE WHEN g.n < k THEN 'cohort_below_k_anonymity_threshold' ELSE NULL END,
         CASE WHEN g.n < k THEN NULL ELSE g.n END,
         CASE WHEN g.n < k THEN NULL ELSE g.low_count END,
         CASE WHEN g.n < k THEN NULL ELSE g.moderate_count END,
         CASE WHEN g.n < k THEN NULL ELSE g.elevated_count END,
         CASE WHEN g.n < k THEN NULL ELSE g.priority_count END,
         CASE WHEN g.n < k THEN NULL ELSE g.mean_score END
  FROM grouped g
  ORDER BY g.unit_id;
END
$fn$;

REVOKE EXECUTE ON FUNCTION sentinel_cohort_summary(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sentinel_cohort_summary(text, text) TO sentinel_commander;

-- Trend statistic for the escalation engine
--
-- The scoring role is write-only with respect to Score rows (step 3.4), and
-- that stays true: this returns two rolling MEANS and a count, never the rows
-- themselves. The escalation engine learns "this person's recent mean is 14
-- points above their prior mean" without being able to read anyone's history.
CREATE OR REPLACE FUNCTION sentinel_score_trend(p_user_id text, p_window integer DEFAULT 3)
RETURNS TABLE (
  n_scores    bigint,
  recent_mean numeric,
  prior_mean  numeric
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  WITH ordered AS (
    SELECT "sentinelScore",
           row_number() OVER (ORDER BY "computedAt" DESC) AS rn
    FROM "Score"
    WHERE "userId" = p_user_id
  )
  SELECT (SELECT count(*) FROM ordered),
         round(avg("sentinelScore") FILTER (WHERE rn <= p_window)::numeric, 4),
         round(avg("sentinelScore") FILTER (WHERE rn > p_window
                                              AND rn <= p_window * 2)::numeric, 4)
  FROM ordered
$fn$;

REVOKE EXECUTE ON FUNCTION sentinel_score_trend(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sentinel_score_trend(text, integer) TO sentinel_scoring;

-- At most one open alert per person
--
-- Enforced by the database rather than by a read-then-write in application
-- code. That keeps the scoring role write-only (no SELECT needed to check for
-- an existing alert) and removes the race between two concurrent scorings.
CREATE UNIQUE INDEX IF NOT EXISTS alert_one_open_per_user
  ON "Alert" ("userId")
  WHERE status <> 'ACTIONED';

-- An alert may only ever be created PENDING_REVIEW (spec principle 6).
--
-- A human decides what happens next. No code path may insert an alert that is
-- already actioned, or that carries a reviewer who has not looked at it.
CREATE OR REPLACE FUNCTION sentinel_alert_must_start_pending()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status <> 'PENDING_REVIEW' THEN
    RAISE EXCEPTION
      'an alert must be created with status PENDING_REVIEW (got %); '
      'human review is mandatory', NEW.status;
  END IF;
  IF NEW."reviewedBy" IS NOT NULL THEN
    RAISE EXCEPTION 'an alert cannot be created already reviewed';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS alert_must_start_pending ON "Alert";
CREATE TRIGGER alert_must_start_pending
  BEFORE INSERT ON "Alert"
  FOR EACH ROW EXECUTE FUNCTION sentinel_alert_must_start_pending();
