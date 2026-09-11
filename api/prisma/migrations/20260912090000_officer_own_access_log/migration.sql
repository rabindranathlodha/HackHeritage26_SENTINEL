-- An officer may read their OWN audit trail, and only their own.
--
-- The console shows each officer the record of what they have looked at. A
-- surveillance tool that logs quietly and never shows the log to the person
-- doing the looking teaches its users that the trail is somebody else's
-- problem; showing it makes the accountability mutual. It is also the same
-- trail the transparency screen promises the person ("who looked, and when"),
-- so the officer sees exactly what the constable is told exists.
--
-- sentinel_welfare_officer has no SELECT on "AuditLog" and does not get one
-- here. This is a SECURITY DEFINER function with the actor filter written
-- INSIDE it, so "their own" is not a WHERE clause an API caller can drop.
--
-- It deliberately does not take a parameter. A function that accepted an actor
-- id would need a check that the id is the caller's, and that check is exactly
-- the kind of thing that gets relaxed later "just for admin".

CREATE OR REPLACE FUNCTION sentinel_officer_access_log(p_limit integer DEFAULT 20)
  RETURNS TABLE (
    id             text,
    action         text,
    target_user_id text,
    at             timestamp(3)
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor text := sentinel_current_user_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'sentinel.user_id is not set; refusing to return an access log';
  END IF;

  RETURN QUERY
    SELECT a.id, a.action, a."targetUserId", a.at
    FROM "AuditLog" a
    WHERE a."actorId" = v_actor
    ORDER BY a.at DESC
    LIMIT least(greatest(p_limit, 1), 200);
END
$fn$;

REVOKE EXECUTE ON FUNCTION sentinel_officer_access_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sentinel_officer_access_log(integer)
  TO sentinel_welfare_officer, sentinel_commander, sentinel_admin;
