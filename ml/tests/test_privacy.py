"""Privacy enforcement tests (spec 12, principle 5)."""

from __future__ import annotations

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
