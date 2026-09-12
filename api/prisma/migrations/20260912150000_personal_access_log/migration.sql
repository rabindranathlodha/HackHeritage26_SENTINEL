-- A person may read the record of who has looked at them.
--
-- The transparency screen already promises this: "Every time someone opens your
-- record, that is written down: who looked, and when." Until now that trail
-- existed and the person could not see it, which made the promise true and
-- unverifiable — the two properties a wary constable has least reason to accept
-- on trust. This is the accessor that makes it checkable by the person it is
-- about.
--
-- It mirrors sentinel_officer_access_log exactly, and for the same reasons:
-- SECURITY DEFINER with the filter written INSIDE the function, no actor
-- parameter, and no SELECT grant on "AuditLog" for the calling role. "Their own"
-- is therefore not a WHERE clause an API caller can drop.
--
-- The filter is on targetUserId, not actorId: a person wants to know who opened
-- THEIR record. Queue views, which carry a NULL target, are not about any one
-- person and are excluded by that alone.

CREATE OR REPLACE FUNCTION sentinel_personal_access_log(p_limit integer DEFAULT 20)
  RETURNS TABLE (
    id         text,
    action     text,
    actor_id   text,
    actor_role text,
    at         timestamp(3)
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_me text := sentinel_current_user_id();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'sentinel.user_id is not set; refusing to return an access log';
  END IF;

  RETURN QUERY
    SELECT a.id, a.action, a."actorId", a."actorRole"::text, a.at
    FROM "AuditLog" a
    WHERE a."targetUserId" = v_me
    ORDER BY a.at DESC
    LIMIT least(greatest(p_limit, 1), 200);
END
$fn$;

REVOKE EXECUTE ON FUNCTION sentinel_personal_access_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sentinel_personal_access_log(integer) TO sentinel_personnel;

COMMENT ON FUNCTION sentinel_personal_access_log(integer) IS
  'The audit trail for one person, readable by that person. Takes no actor '
  'argument on purpose: a function accepting an id would need a check that the '
  'id belongs to the caller, and that check is the kind that gets relaxed later '
  '"just for admin".';
