-- The escalation engine needs the trend thresholds, but granting the scoring
-- role SELECT on "PrivacyConfig" would hand it a table it has no other business
-- reading. Expose the two values through a definer function instead, the same
-- way sentinel_k_threshold() exposes k.

CREATE OR REPLACE FUNCTION sentinel_trend_config()
RETURNS TABLE ("trendDelta" double precision, "trendWindow" integer)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT "trendDelta", "trendWindow" FROM "PrivacyConfig" WHERE id
$fn$;

REVOKE EXECUTE ON FUNCTION sentinel_trend_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sentinel_trend_config() TO sentinel_scoring;
