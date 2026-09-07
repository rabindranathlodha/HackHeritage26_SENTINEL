-- SENTINEL — Row-Level Security policies (spec Section 4.1 / principle 5).
--
-- Privacy is enforced HERE, in the data layer, so it cannot be bypassed by
-- calling the API directly. The request path never connects as the table owner.
--
-- Role model
--   sentinel_app              LOGIN, owns nothing, has NO table privileges.
--                             The API and ML service connect as this role and
--                             must SET LOCAL ROLE sentinel_<role> plus
--                             SET LOCAL sentinel.user_id = <cuid> per
--                             transaction. Forgetting to do so fails CLOSED.
--   sentinel_personnel        own rows only
--   sentinel_welfare_officer  assigned personnel WITH an active alert, audited
--   sentinel_commander        aggregates only — never an individual welfare row
--   sentinel_admin            user/role management only — no welfare content
--
-- The four app roles are granted to sentinel_app WITH INHERIT FALSE. This is
-- load-bearing: Postgres matches CREATE POLICY ... TO <role> by *inherited*
-- membership, so an inheriting login would collect the union of all four
-- roles' policies and defeat the isolation. With INHERIT FALSE, no policy
-- applies until an explicit SET ROLE selects exactly one.

-- Roles (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_personnel') THEN
    CREATE ROLE sentinel_personnel NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_welfare_officer') THEN
    CREATE ROLE sentinel_welfare_officer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_commander') THEN
    CREATE ROLE sentinel_commander NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_admin') THEN
    CREATE ROLE sentinel_admin NOLOGIN;
  END IF;
  -- Password is set out-of-band by scripts/bootstrap_db.sh from env, never here.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_app') THEN
    CREATE ROLE sentinel_app NOLOGIN;
  END IF;
END
$$;

GRANT sentinel_personnel       TO sentinel_app WITH INHERIT FALSE;
GRANT sentinel_welfare_officer TO sentinel_app WITH INHERIT FALSE;
GRANT sentinel_commander       TO sentinel_app WITH INHERIT FALSE;
GRANT sentinel_admin           TO sentinel_app WITH INHERIT FALSE;

GRANT USAGE ON SCHEMA public TO sentinel_app, sentinel_personnel,
  sentinel_welfare_officer, sentinel_commander, sentinel_admin;

-- Session identity helpers

-- The acting user's id, taken from a per-transaction GUC. NOT security definer:
-- it only reads session state.
CREATE OR REPLACE FUNCTION sentinel_current_user_id() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
AS $fn$
  SELECT NULLIF(current_setting('sentinel.user_id', true), '')
$fn$;

-- The acting user's unit. SECURITY DEFINER so a policy on "User" can call it
-- without recursing into that table's own policies.
CREATE OR REPLACE FUNCTION sentinel_actor_unit() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT "unitId" FROM "User" WHERE id = sentinel_current_user_id()
$fn$;

-- Spec 4.1: an officer may see an individual only where the person is assigned
-- to them AND an active alert exists. Active means not yet ACTIONED.
CREATE OR REPLACE FUNCTION sentinel_officer_may_view(p_target text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM "User" u
    WHERE u.id = p_target
      AND u."welfareOfficerId" = sentinel_current_user_id()
      AND EXISTS (
        SELECT 1 FROM "Alert" a
        WHERE a."userId" = u.id AND a.status <> 'ACTIONED'
      )
  )
$fn$;

-- Audit trail (append-only)
--
-- Spec 4.1 prefers a trigger so it cannot be bypassed. PostgreSQL has no SELECT
-- trigger, so individual-row reads by an officer are routed through SECURITY
-- DEFINER accessor functions below, and direct SELECT on those tables is NOT
-- granted to the officer role. The audit therefore still lives inside the
-- database — an API caller cannot read an individual row without logging it.
CREATE OR REPLACE FUNCTION sentinel_log_access(p_action text, p_target text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor text := sentinel_current_user_id();
  v_role  "Role";
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'sentinel.user_id is not set; refusing unattributable access';
  END IF;
  SELECT role INTO v_role FROM "User" WHERE id = v_actor;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'unknown actor %', v_actor;
  END IF;
  INSERT INTO "AuditLog" (id, "actorId", "actorRole", action, "targetUserId", at)
  VALUES (gen_random_uuid()::text, v_actor, v_role, p_action, p_target, now());
END
$fn$;

-- Audited accessors — the ONLY path to an individual welfare row for an officer
CREATE OR REPLACE FUNCTION sentinel_officer_view_scores(p_target text)
  RETURNS SETOF "Score"
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT sentinel_officer_may_view(p_target) THEN
    RAISE EXCEPTION 'access denied: not an assigned person with an active alert';
  END IF;
  PERFORM sentinel_log_access('VIEW_INDIVIDUAL_SCORE', p_target);
  RETURN QUERY SELECT * FROM "Score" WHERE "userId" = p_target ORDER BY "computedAt" DESC;
END
$fn$;

CREATE OR REPLACE FUNCTION sentinel_officer_view_assessments(p_target text)
  RETURNS SETOF "Assessment"
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT sentinel_officer_may_view(p_target) THEN
    RAISE EXCEPTION 'access denied: not an assigned person with an active alert';
  END IF;
  PERFORM sentinel_log_access('VIEW_INDIVIDUAL_ASSESSMENT', p_target);
  RETURN QUERY SELECT * FROM "Assessment" WHERE "userId" = p_target ORDER BY "submittedAt" DESC;
END
$fn$;

CREATE OR REPLACE FUNCTION sentinel_officer_alert_queue()
  RETURNS SETOF "Alert"
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM sentinel_log_access('VIEW_ALERT_QUEUE', NULL);
  RETURN QUERY
    SELECT a.* FROM "Alert" a
    JOIN "User" u ON u.id = a."userId"
    WHERE u."welfareOfficerId" = sentinel_current_user_id()
      AND a.status <> 'ACTIONED'
    ORDER BY a."createdAt" DESC;
END
$fn$;

REVOKE EXECUTE ON FUNCTION sentinel_log_access(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sentinel_officer_view_scores(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sentinel_officer_view_assessments(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sentinel_officer_alert_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sentinel_officer_view_scores(text)      TO sentinel_welfare_officer;
GRANT EXECUTE ON FUNCTION sentinel_officer_view_assessments(text) TO sentinel_welfare_officer;
GRANT EXECUTE ON FUNCTION sentinel_officer_alert_queue()          TO sentinel_welfare_officer;

-- Table privileges — deny by default, then grant the minimum
REVOKE ALL ON "User", "HrSignal", "Assessment", "Score", "Alert", "AuditLog" FROM PUBLIC;

-- User: cohort membership. Not welfare content.
GRANT SELECT ON "User" TO sentinel_personnel, sentinel_welfare_officer, sentinel_commander;
GRANT SELECT, INSERT, UPDATE, DELETE ON "User" TO sentinel_admin;

-- HrSignal: individual behavioural input. Commander and admin get nothing.
GRANT SELECT ON "HrSignal" TO sentinel_personnel, sentinel_welfare_officer;

-- Assessment / Score: the person sees their own. The officer has NO direct
-- SELECT — reads go through the audited accessors above.
GRANT SELECT, INSERT ON "Assessment" TO sentinel_personnel;
GRANT SELECT ON "Score" TO sentinel_personnel;

-- Alert: no direct SELECT for anyone. The officer uses the audited queue, and
-- may update the status of an alert already in their own scope.
GRANT UPDATE ON "Alert" TO sentinel_welfare_officer;

-- AuditLog is append-only and written only by sentinel_log_access().
GRANT SELECT ON "AuditLog" TO sentinel_admin;

-- Row-Level Security
ALTER TABLE "User"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrSignal"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Score"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Alert"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"   ENABLE ROW LEVEL SECURITY;

-- User -----------------------------------------------------------------------
CREATE POLICY user_self_read ON "User" FOR SELECT TO sentinel_personnel
  USING (id = sentinel_current_user_id());

CREATE POLICY user_officer_read ON "User" FOR SELECT TO sentinel_welfare_officer
  USING (id = sentinel_current_user_id()
         OR "welfareOfficerId" = sentinel_current_user_id());

-- A commander sees who is in their unit (for cohort aggregates) and nothing
-- about anyone's welfare state.
CREATE POLICY user_commander_unit_read ON "User" FOR SELECT TO sentinel_commander
  USING ("unitId" = sentinel_actor_unit());

CREATE POLICY user_admin_manage ON "User" FOR ALL TO sentinel_admin
  USING (true) WITH CHECK (true);

-- HrSignal -------------------------------------------------------------------
CREATE POLICY hrsignal_self_read ON "HrSignal" FOR SELECT TO sentinel_personnel
  USING ("userId" = sentinel_current_user_id());

CREATE POLICY hrsignal_officer_read ON "HrSignal" FOR SELECT TO sentinel_welfare_officer
  USING (sentinel_officer_may_view("userId"));
-- No commander or admin policy: default deny.

-- Assessment -----------------------------------------------------------------
CREATE POLICY assessment_self_read ON "Assessment" FOR SELECT TO sentinel_personnel
  USING ("userId" = sentinel_current_user_id());

CREATE POLICY assessment_self_insert ON "Assessment" FOR INSERT TO sentinel_personnel
  WITH CHECK ("userId" = sentinel_current_user_id());

-- Defence in depth: even if SELECT were granted later, scope still applies.
CREATE POLICY assessment_officer_read ON "Assessment" FOR SELECT TO sentinel_welfare_officer
  USING (sentinel_officer_may_view("userId"));

-- Score ----------------------------------------------------------------------
CREATE POLICY score_self_read ON "Score" FOR SELECT TO sentinel_personnel
  USING ("userId" = sentinel_current_user_id());

CREATE POLICY score_officer_read ON "Score" FOR SELECT TO sentinel_welfare_officer
  USING (sentinel_officer_may_view("userId"));
-- No commander policy: a commander can NEVER read an individual score row.

-- Alert ----------------------------------------------------------------------
CREATE POLICY alert_officer_read ON "Alert" FOR SELECT TO sentinel_welfare_officer
  USING (sentinel_officer_may_view("userId"));

CREATE POLICY alert_officer_update ON "Alert" FOR UPDATE TO sentinel_welfare_officer
  USING (sentinel_officer_may_view("userId"))
  WITH CHECK (sentinel_officer_may_view("userId"));
-- No commander policy, no personnel policy, no auto-action path.

-- AuditLog -------------------------------------------------------------------
CREATE POLICY auditlog_admin_read ON "AuditLog" FOR SELECT TO sentinel_admin
  USING (true);
-- No UPDATE or DELETE policy for any role: the trail is append-only.
