"""Privacy enforcement tests (spec 12, principle 5)."""

from __future__ import annotations

import base64

import psycopg
import pytest

from tests.conftest import act_as, requires_db

pytestmark = requires_db


# Fail-closed baseline


def test_request_role_has_no_access_before_choosing_a_role(app_conn, cohort):
    """Forgetting SET ROLE must yield nothing, not everything."""
    app_conn.execute("SELECT set_config('sentinel.user_id', %s, true)", (cohort.officer,))

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute('SELECT * FROM "Score"').fetchall()


# (a) Commander isolation


@pytest.mark.parametrize("table", ["Score", "Assessment", "Alert", "HrSignal"])
def test_commander_cannot_select_individual_welfare_rows(app_conn, cohort, table):
    """A commander holds no SELECT privilege on any individual welfare table."""
    act_as(app_conn, "sentinel_commander", cohort.commander)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(f'SELECT * FROM "{table}"').fetchall()


def test_commander_is_blocked_by_rls_even_if_granted_select(
    app_conn, owner_conn, cohort
):
    """The privilege grant is not the only thing standing in the way.

    Grant the commander role direct SELECT on Score, then show RLS still
    returns zero rows. This is the layer an evaluator probes: revoke-based
    security alone would fail open the moment someone adds a grant.
    """
    owner_conn.execute('GRANT SELECT ON "Score" TO sentinel_commander')
    try:
        act_as(app_conn, "sentinel_commander", cohort.commander)
        rows = app_conn.execute('SELECT * FROM "Score"').fetchall()
        assert rows == [], "RLS must return no individual score rows to a commander"
    finally:
        app_conn.rollback()
        owner_conn.execute('REVOKE SELECT ON "Score" FROM sentinel_commander')


def test_commander_can_still_see_unit_membership_for_aggregates(app_conn, cohort):
    """Commanders are not blind — they see cohort membership, not welfare state."""
    act_as(app_conn, "sentinel_commander", cohort.commander)

    rows = app_conn.execute(
        'SELECT id FROM "User" WHERE "unitId" = %s', (cohort.unit,)
    ).fetchall()

    assert len(rows) == 6


# (b) Welfare officer scoping


def test_officer_sees_only_assigned_users_with_an_active_alert(app_conn, cohort):
    act_as(app_conn, "sentinel_welfare_officer", cohort.officer)

    # There is no unaudited path: direct SELECT is not granted to the officer.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(
            'SELECT * FROM "Score" WHERE "userId" = %s', (cohort.alerted,)
        ).fetchall()
    app_conn.rollback()

    # The audited accessor is the only way in, and it yields exactly this person.
    act_as(app_conn, "sentinel_welfare_officer", cohort.officer)
    visible = app_conn.execute(
        "SELECT * FROM sentinel_officer_view_scores(%s)", (cohort.alerted,)
    ).fetchall()
    assert len(visible) == 1


def test_officer_cannot_view_assigned_user_without_an_active_alert(app_conn, cohort):
    """Assignment alone is not enough — an active alert is also required."""
    act_as(app_conn, "sentinel_welfare_officer", cohort.officer)

    with pytest.raises(psycopg.errors.RaiseException):
        app_conn.execute(
            "SELECT * FROM sentinel_officer_view_scores(%s)", (cohort.quiet,)
        ).fetchall()


def test_officer_cannot_view_a_user_assigned_to_another_officer(app_conn, cohort):
    act_as(app_conn, "sentinel_welfare_officer", cohort.officer)

    with pytest.raises(psycopg.errors.RaiseException):
        app_conn.execute(
            "SELECT * FROM sentinel_officer_view_scores(%s)", (cohort.unassigned,)
        ).fetchall()


def test_officer_alert_queue_contains_only_their_own_assigned_alerts(app_conn, cohort):
    act_as(app_conn, "sentinel_welfare_officer", cohort.officer)

    rows = app_conn.execute("SELECT * FROM sentinel_officer_alert_queue()").fetchall()

    assert len(rows) == 1


def test_other_officer_sees_an_empty_queue(app_conn, cohort):
    act_as(app_conn, "sentinel_welfare_officer", cohort.other_officer)

    rows = app_conn.execute("SELECT * FROM sentinel_officer_alert_queue()").fetchall()

    assert rows == []


# Personnel scoping


def test_personnel_see_only_their_own_rows(app_conn, cohort):
    act_as(app_conn, "sentinel_personnel", cohort.alerted)

    rows = app_conn.execute('SELECT "userId" FROM "Score"').fetchall()

    assert [r[0] for r in rows] == [cohort.alerted]


def test_personnel_cannot_read_alerts_at_all(app_conn, cohort):
    act_as(app_conn, "sentinel_personnel", cohort.alerted)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute('SELECT * FROM "Alert"').fetchall()


# Admin purpose limitation


@pytest.mark.parametrize("table", ["Score", "Assessment", "Alert", "HrSignal"])
def test_admin_has_no_access_to_welfare_content(app_conn, cohort, table):
    """ADMIN manages users and roles only (spec 4.1 purpose limitation)."""
    act_as(app_conn, "sentinel_admin", cohort.commander)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(f'SELECT * FROM "{table}"').fetchall()


# (e) Audit trail


def test_individual_access_writes_an_audit_row(app_conn, owner_conn, cohort):
    act_as(app_conn, "sentinel_welfare_officer", cohort.officer)
    app_conn.execute(
        "SELECT * FROM sentinel_officer_view_scores(%s)", (cohort.alerted,)
    ).fetchall()
    app_conn.commit()

    rows = owner_conn.execute(
        'SELECT action, "targetUserId", "actorRole" FROM "AuditLog" '
        'WHERE "actorId" = %s',
        (cohort.officer,),
    ).fetchall()

    assert ("VIEW_INDIVIDUAL_SCORE", cohort.alerted, "WELFARE_OFFICER") in rows


def test_access_without_an_identity_is_refused_rather_than_unattributed(
    app_conn, cohort
):
    """No identity means no audit row is possible, so the read is refused."""
    app_conn.execute("SET LOCAL ROLE sentinel_welfare_officer")

    with pytest.raises(psycopg.errors.RaiseException):
        app_conn.execute("SELECT * FROM sentinel_officer_alert_queue()").fetchall()


def test_audit_trail_is_append_only(app_conn, owner_conn, cohort):
    act_as(app_conn, "sentinel_welfare_officer", cohort.officer)
    app_conn.execute(
        "SELECT * FROM sentinel_officer_view_scores(%s)", (cohort.alerted,)
    ).fetchall()
    app_conn.commit()

    act_as(app_conn, "sentinel_admin", cohort.commander)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute('DELETE FROM "AuditLog"')


# Field-level encryption at rest (spec 9.3)


def test_questionnaire_answers_are_ciphertext_in_the_database(owner_conn):
    """Spec 9.3: the most sensitive column must not be readable from the table.

    Checked as the OWNER — the role with the most access in the system. If the
    answers were recoverable from a database dump, every other control here
    would be decoration.
    """
    column_type = owner_conn.execute(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_name = 'Assessment' AND column_name = 'responsesEnc'"
    ).fetchone()

    assert column_type is not None, "the encrypted column is missing"
    assert column_type[0] == "bytea"

    # The plaintext column must be gone, not merely unused.
    plaintext = owner_conn.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'Assessment' AND column_name = 'responses'"
    ).fetchone()
    assert plaintext is None, "the plaintext questionnaire column still exists"


def test_stored_answers_do_not_reveal_likert_values(owner_conn, cohort):
    """A short structured payload must not be guessable from its ciphertext."""
    blob = owner_conn.execute(
        'SELECT "responsesEnc" FROM "Assessment" WHERE "userId" = %s',
        (cohort.alerted,),
    ).fetchone()[0]

    raw = bytes(blob)
    # 12-byte IV + 16-byte GCM tag before any ciphertext at all.
    assert len(raw) > 28
    assert b"[" not in raw and b"," not in raw, "JSON structure is visible in the stored value"


def test_score_rows_cannot_outlive_the_person_they_describe(owner_conn):
    """The foreign key Section 4 omitted."""
    constraint = owner_conn.execute(
        "SELECT conname FROM pg_constraint "
        "WHERE conrelid = '\"Score\"'::regclass AND contype = 'f'"
    ).fetchone()

    assert constraint is not None, "Score still has no foreign key to User"


# Sign-in credentials (PWA spec 3.2)
#
# The PWA needed a password to check, and the User model deliberately carries no
# credential of any kind. Credentials therefore live in their own table with
# their own role. These tests are the reason that separation is worth the extra
# table: they would all fail if the hash were a column on User.


@pytest.mark.parametrize(
    "db_role",
    ["sentinel_personnel", "sentinel_welfare_officer", "sentinel_commander",
     "sentinel_admin", "sentinel_scoring"],
)
def test_no_application_role_can_read_a_password_hash(app_conn, cohort, db_role):
    """A session must not be able to read the secret that authenticated it."""
    act_as(app_conn, db_role, cohort.alerted)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute('SELECT * FROM "PersonnelCredential"').fetchall()


@pytest.mark.parametrize("table", ["Score", "Assessment", "Alert", "HrSignal"])
def test_the_auth_role_cannot_reach_welfare_content(app_conn, cohort, table):
    """sentinel_auth answers one question. Its blast radius stays that small."""
    act_as(app_conn, "sentinel_auth", cohort.alerted)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(f'SELECT * FROM "{table}"').fetchall()


def test_the_auth_role_cannot_issue_a_credential(app_conn, cohort):
    """Verifying a password is a request-path action; issuing one is not.

    sentinel_auth holds SELECT and an UPDATE limited to lastLoginAt. Without
    this boundary, a flaw in the sign-in path could mint a working credential
    for any account.
    """
    act_as(app_conn, "sentinel_auth", cohort.alerted)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(
            'INSERT INTO "PersonnelCredential" ("userId", "loginId", "passwordHash") '
            "VALUES (%s, %s, %s)",
            (cohort.alerted, f"forged-{cohort.alerted}", "scrypt$1$1$1$AA==$AA=="),
        )


def test_a_stored_credential_is_not_a_recoverable_password(owner_conn):
    """Whatever is stored, it is not the password and cannot be turned back."""
    row = owner_conn.execute(
        'SELECT "passwordHash" FROM "PersonnelCredential" LIMIT 1'
    ).fetchone()
    if row is None:
        pytest.skip("no credentials issued; run prisma/issue-credentials.ts")

    stored = row[0]
    algorithm, n, r, p, salt, digest = stored.split("$")
    assert algorithm == "scrypt"
    # A memory-hard cost, not a bare digest. These are the OWASP-shaped
    # parameters the hashing module writes alongside every hash so an old one
    # stays verifiable after the cost is raised.
    assert int(n) >= 65536
    assert int(r) >= 8 and int(p) >= 1
    assert len(base64.b64decode(salt)) >= 16
    assert len(base64.b64decode(digest)) >= 32


# Self-service consent (PWA spec 3.8, principle 4)
#
# Consent is only reversible if the person can reverse it, which means
# sentinel_personnel needs UPDATE on "User" — and that is a privilege worth
# bounding precisely. The grant is column-scoped so a consent toggle cannot
# become a way to change your own role.


def test_a_person_can_withdraw_their_own_consent(app_conn, owner_conn, cohort):
    """Principle 4: opt-in, and off again at any time, by the person themselves."""
    owner_conn.execute(
        'UPDATE "User" SET "biometricConsent" = true WHERE id = %s', (cohort.alerted,)
    )
    owner_conn.commit()

    act_as(app_conn, "sentinel_personnel", cohort.alerted)
    app_conn.execute(
        'UPDATE "User" SET "biometricConsent" = false WHERE id = %s', (cohort.alerted,)
    )
    app_conn.commit()

    still = owner_conn.execute(
        'SELECT "biometricConsent" FROM "User" WHERE id = %s', (cohort.alerted,)
    ).fetchone()
    assert still[0] is False


def test_the_consent_grant_cannot_be_used_to_change_a_role(app_conn, cohort):
    """The escalation this column-scoped grant exists to prevent.

    A table-wide UPDATE would let anyone with a session promote themselves to
    COMMANDER — and a commander sees cohort aggregates. Postgres checks column
    privileges separately from row policies, so this is denied outright rather
    than filtered to zero rows.
    """
    act_as(app_conn, "sentinel_personnel", cohort.alerted)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(
            'UPDATE "User" SET role = \'COMMANDER\' WHERE id = %s', (cohort.alerted,)
        )


@pytest.mark.parametrize("column", ["unitId", "welfareOfficerId"])
def test_no_other_column_can_be_changed(app_conn, cohort, column):
    """Reassigning your own unit or welfare officer is not a consent decision."""
    act_as(app_conn, "sentinel_personnel", cohort.alerted)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(
            f'UPDATE "User" SET "{column}" = %s WHERE id = %s',
            ("something-else", cohort.alerted),
        )


def test_a_person_cannot_change_anybody_elses_consent(app_conn, owner_conn, cohort):
    """Row policy, not just column policy: the update matches no row at all."""
    owner_conn.execute(
        'UPDATE "User" SET "biometricConsent" = false WHERE id = %s', (cohort.quiet,)
    )
    owner_conn.commit()

    act_as(app_conn, "sentinel_personnel", cohort.alerted)
    app_conn.execute(
        'UPDATE "User" SET "biometricConsent" = true WHERE id = %s', (cohort.quiet,)
    )
    app_conn.commit()

    unchanged = owner_conn.execute(
        'SELECT "biometricConsent" FROM "User" WHERE id = %s', (cohort.quiet,)
    ).fetchone()
    assert unchanged[0] is False
