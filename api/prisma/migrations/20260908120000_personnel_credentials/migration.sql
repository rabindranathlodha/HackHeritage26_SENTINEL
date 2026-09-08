-- SENTINEL — sign-in credentials for the Personnel Companion PWA.
--
-- PWA spec 4.1 offers "magic-link or credential". Magic-link needs an email
-- address per person, and Section 4's User model deliberately carries no email,
-- no name and no service number — an absence the ML suite asserts as a test
-- (test_generator_produces_no_personal_identifiers). Adding one to enable a
-- login would trade a privacy property for a convenience. So: credentials, and
-- they live in their own table rather than as columns on User.
--
-- Why a separate table rather than User.passwordHash:
--   * sentinel_personnel can SELECT its own User row. A hash on that row would
--     be readable by the very sessions it authenticates.
--   * The four app roles get NO privilege here at all. Only sentinel_auth,
--     which exists solely to answer "is this password correct", can read it.
--   * Credentials are an access-control concern, not welfare data. Keeping them
--     out of the welfare model keeps Section 4 authoritative for what it covers.

CREATE TABLE IF NOT EXISTS "PersonnelCredential" (
  "userId"       text PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  -- A non-personal handle. Seeded as the person's own opaque user id, so no
  -- name or service number enters the system through the login form.
  "loginId"      text        NOT NULL UNIQUE,
  -- scrypt, encoded as scrypt$N$r$p$<salt-b64>$<hash-b64>. Never a plaintext
  -- password, and never a reversible encoding.
  "passwordHash" text        NOT NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "lastLoginAt"  timestamptz
);

REVOKE ALL ON "PersonnelCredential" FROM PUBLIC;

-- The authentication role.
--
-- INHERIT FALSE for the same reason as the four app roles: policies are matched
-- by inherited membership, so an inheriting login would silently collect this
-- role's read access to the credential table on top of whichever role it chose.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_auth') THEN
    CREATE ROLE sentinel_auth NOLOGIN;
  END IF;
END
$$;

GRANT sentinel_auth TO sentinel_app WITH INHERIT FALSE;
GRANT USAGE ON SCHEMA public TO sentinel_auth;

-- Exactly what verifying a password requires and nothing more: read the hash,
-- read the role being claimed, stamp the last login. No INSERT, no DELETE —
-- issuing a credential is an owner-only operation run by the seed script.
GRANT SELECT ON "PersonnelCredential" TO sentinel_auth;
GRANT UPDATE ("lastLoginAt") ON "PersonnelCredential" TO sentinel_auth;
GRANT SELECT ON "User" TO sentinel_auth;

ALTER TABLE "PersonnelCredential" ENABLE ROW LEVEL SECURITY;

CREATE POLICY credential_auth_read ON "PersonnelCredential"
  FOR SELECT TO sentinel_auth USING (true);

CREATE POLICY credential_auth_stamp ON "PersonnelCredential"
  FOR UPDATE TO sentinel_auth USING (true) WITH CHECK (true);

-- sentinel_auth must never reach welfare content. It exists to answer one
-- question and its blast radius stays that small.
CREATE POLICY user_auth_read ON "User" FOR SELECT TO sentinel_auth USING (true);

COMMENT ON TABLE "PersonnelCredential" IS
  'Sign-in secrets for the Personnel Companion PWA. Readable only by '
  'sentinel_auth. No application role has any privilege on this table.';
