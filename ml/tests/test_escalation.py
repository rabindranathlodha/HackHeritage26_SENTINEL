"""Escalation and k-anonymity tests (spec 8 and 9, step 3.9)."""

from __future__ import annotations

import ast
import os
import pathlib

import psycopg
import pytest

from app.privacy.kanon import REFUSAL_REASON, cohort_summary, k_threshold
from app.services import escalation
from tests.conftest import requires_db

pytestmark = requires_db

APP_DIR = pathlib.Path(__file__).resolve().parent.parent / "app"


# Autocommit: these are torn down after the cohort fixture, so an open
# transaction here would block its DELETE and hang the suite.
@pytest.fixture()
def scoring_conn():
    with psycopg.connect(os.environ["SENTINEL_APP_DATABASE_URL"],
                         autocommit=True) as conn:
        conn.execute("SET ROLE sentinel_scoring")
        yield conn


@pytest.fixture()
def commander_conn():
    with psycopg.connect(os.environ["SENTINEL_APP_DATABASE_URL"],
                         autocommit=True) as conn:
        conn.execute("SET ROLE sentinel_commander")
        yield conn


# (c) k-anonymity


def test_a_sub_threshold_cohort_returns_a_refusal_not_partial_data(commander_conn):
    """Spec 9.1: a refusal object, never a rounded or partial figure."""
    k = k_threshold(commander_conn)
    # Filtering to the rarest band produces cohorts far below k.
    cohorts = cohort_summary(commander_conn, band="PRIORITY_REVIEW")

    refused = [c for c in cohorts if c["refused"]]
    assert refused, "expected at least one suppressed cohort under this filter"

    for cohort in refused:
        assert cohort["reason"] == REFUSAL_REASON
        assert cohort["k"] == k
        # Nothing about the cohort's contents may survive the refusal.
        assert "n" not in cohort
        assert "band_counts" not in cohort
        assert "mean_score" not in cohort


def test_cohorts_at_or_above_the_threshold_are_returned(commander_conn):
    """Suppression must not be so blunt that the dashboard is useless."""
    k = k_threshold(commander_conn)
    cohorts = cohort_summary(commander_conn)

    allowed = [c for c in cohorts if not c["refused"]]
    assert allowed, "no cohort cleared the threshold; run data_gen.score_population"
    for cohort in allowed:
        assert cohort["n"] >= k


def test_suppression_cannot_be_bypassed_by_calling_the_sql_directly(commander_conn):
    """The API is not the enforcement point — the database is.

    This is the bypass an evaluator would actually try: skip the service and
    query as the commander role.
    """
    k = k_threshold(commander_conn)
    rows = commander_conn.execute(
        "SELECT refused, n FROM sentinel_cohort_summary(NULL, 'PRIORITY_REVIEW')"
    ).fetchall()

    assert rows
    for refused, n in rows:
        if refused:
            assert n is None, "a suppressed cohort leaked its count"
        else:
            assert n >= k


def test_the_summary_function_has_no_parameter_that_disables_suppression(owner_conn):
    """Spec 9.1: no 'skip' flag anywhere in the call chain."""
    signature = owner_conn.execute(
        "SELECT pg_get_function_arguments(oid) FROM pg_proc "
        "WHERE proname = 'sentinel_cohort_summary'"
    ).fetchone()[0]

    assert "p_unit_id" in signature and "p_band" in signature
    for forbidden in ("skip", "bypass", "include_small", "unsafe", "k_override", "raw"):
        assert forbidden not in signature.lower()


def test_a_commander_still_cannot_reach_individual_rows_behind_the_aggregate(
    commander_conn,
):
    """The aggregate endpoint must not become an individual-row leak."""
    for table in ("Score", "Assessment", "Alert", "HrSignal"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            commander_conn.execute(f'SELECT * FROM "{table}"').fetchall()


def test_the_scoring_role_cannot_read_cohort_aggregates(scoring_conn):
    """Least privilege in both directions: the writer is not also a reader."""
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        scoring_conn.execute(
            "SELECT * FROM sentinel_cohort_summary(NULL, NULL)"
        ).fetchall()


def test_the_threshold_in_force_is_the_one_in_the_database(commander_conn):
    """SQL and the application read the same number, not two copies."""
    assert k_threshold(commander_conn) == 10


# (d) escalation never auto-contacts anyone


# Modules that exist to contact a human. None may be imported anywhere in the
# serving tree.
FORBIDDEN_IMPORTS = {
    "smtplib", "aiosmtplib", "email", "sendgrid", "twilio", "boto3", "slack_sdk",
    "firebase_admin", "requests", "httpx", "aiohttp", "urllib.request", "socket",
}

# Outbound calls, as (object, attribute) pairs.
FORBIDDEN_CALLS = {
    ("requests", "post"), ("requests", "get"), ("httpx", "post"), ("httpx", "get"),
    ("smtplib", "SMTP"), ("urlopen", ""),
}


def _module_roots(tree: ast.AST) -> set[str]:
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            roots.add(node.module)
    return roots


def _outbound_calls(tree: ast.AST) -> set[tuple[str, str]]:
    calls: set[tuple[str, str]] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            value = node.func.value
            if isinstance(value, ast.Name):
                calls.add((value.id, node.func.attr))
    return calls


def test_no_outbound_communication_machinery_exists_in_the_serving_tree():
    """Spec principle 6, enforced statically over the whole app/ package."""
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        name = path.relative_to(APP_DIR)

        for module in _module_roots(tree):
            root = module.split(".")[0]
            if root in FORBIDDEN_IMPORTS or module in FORBIDDEN_IMPORTS:
                offenders.append(f"{name}: imports {module}")

        for obj, attr in _outbound_calls(tree):
            if (obj, attr) in FORBIDDEN_CALLS:
                offenders.append(f"{name}: calls {obj}.{attr}()")

    assert not offenders, f"outbound-communication machinery found: {offenders}"


def test_the_scan_would_actually_catch_something(tmp_path):
    """A guard that cannot fail is not a guard.

    Proves the detector fires on a file that really does contact someone,
    so a passing run above means something.
    """
    planted = tmp_path / "leaky.py"
    planted.write_text(
        "\n".join([
            "import smtplib",
            "def notify(person):",
            "    smtplib.SMTP('localhost').sendmail('a', person, 'you are flagged')",
        ]),
        encoding="utf-8",
    )
    tree = ast.parse(planted.read_text(encoding="utf-8"))

    assert "smtplib" in _module_roots(tree)
    assert ("smtplib", "SMTP") in _outbound_calls(tree)


def test_escalation_creates_a_pending_alert_and_nothing_else(
    scoring_conn, owner_conn, cohort
):
    decision = escalation.evaluate(cohort.quiet, "PRIORITY_REVIEW", scoring_conn)

    assert decision.escalated is True
    assert escalation.REASON_PRIORITY_BAND in decision.reasons

    rows = owner_conn.execute(
        'SELECT status, "reviewedBy" FROM "Alert" WHERE "userId" = %s', (cohort.quiet,)
    ).fetchall()
    assert rows == [("PENDING_REVIEW", None)]


def test_the_escalation_payload_states_that_nothing_was_done(scoring_conn, cohort):
    """No consumer of this response can imply the system acted on its own."""
    decision = escalation.evaluate(cohort.quiet, "PRIORITY_REVIEW", scoring_conn)

    payload = decision.to_dict()
    assert payload["action_taken"] == "none"
    assert payload["awaiting"] == "welfare_officer_review"


def test_a_commander_cannot_see_an_alert_that_escalation_created(
    scoring_conn, commander_conn, cohort
):
    escalation.evaluate(cohort.quiet, "PRIORITY_REVIEW", scoring_conn)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        commander_conn.execute('SELECT * FROM "Alert"').fetchall()


def test_the_database_rejects_an_alert_that_does_not_start_pending(owner_conn, cohort):
    """Even the table owner cannot write a pre-actioned alert."""
    with pytest.raises(psycopg.errors.RaiseException, match="PENDING_REVIEW"):
        owner_conn.execute(
            'INSERT INTO "Alert" (id, "userId", band, status) '
            "VALUES (%s, %s, 'ELEVATED'::\"RiskBand\", 'ACTIONED')",
            (f"bad-{cohort.quiet}", cohort.quiet),
        )


def test_the_database_rejects_an_alert_created_already_reviewed(owner_conn, cohort):
    with pytest.raises(psycopg.errors.RaiseException, match="already reviewed"):
        owner_conn.execute(
            'INSERT INTO "Alert" (id, "userId", band, status, "reviewedBy") '
            "VALUES (%s, %s, 'ELEVATED'::\"RiskBand\", 'PENDING_REVIEW', %s)",
            (f"bad2-{cohort.quiet}", cohort.quiet, cohort.officer),
        )


def test_repeated_escalation_does_not_bury_an_officer_in_duplicates(
    scoring_conn, owner_conn, cohort
):
    for _ in range(4):
        escalation.evaluate(cohort.quiet, "PRIORITY_REVIEW", scoring_conn)

    count = owner_conn.execute(
        'SELECT count(*) FROM "Alert" WHERE "userId" = %s', (cohort.quiet,)
    ).fetchone()[0]
    assert count == 1


def test_a_low_band_with_no_trend_does_not_escalate(scoring_conn, cohort):
    decision = escalation.evaluate(cohort.quiet, "LOW", scoring_conn)

    assert decision.escalated is False
    assert decision.reasons == []


# Sustained-trend escalation (spec 8)


def test_a_sustained_upward_trend_escalates_below_the_top_band(
    scoring_conn, owner_conn, cohort
):
    """The second net under Model A's conservative PRIORITY_REVIEW recall.

    A person whose scores are climbing steadily gets a human look before they
    reach the top band.
    """
    rising = [10.0, 12.0, 14.0, 40.0, 44.0, 48.0]  # prior mean 12, recent mean 44
    for i, score in enumerate(rising):
        owner_conn.execute(
            'INSERT INTO "Score" (id, "userId", "computedAt", "scoreA", '
            '"sentinelScore", band, "confidenceLow", "confidenceHigh", "shapCategories") '
            "VALUES (%s, %s, now() - make_interval(days => %s), %s, %s, "
            "'MODERATE'::\"RiskBand\", 0, 100, '{}'::jsonb)",
            (f"tr-{cohort.quiet}-{i}", cohort.quiet, len(rising) - i,
             score / 100.0, score),
        )

    decision = escalation.evaluate(cohort.quiet, "MODERATE", scoring_conn)

    assert decision.escalated is True
    assert escalation.REASON_SUSTAINED_TREND in decision.reasons

    owner_conn.execute('DELETE FROM "Score" WHERE "userId" = %s', (cohort.quiet,))


def test_a_flat_history_does_not_escalate(scoring_conn, owner_conn, cohort):
    """Noise around a stable level must not trigger review."""
    flat = [30.0, 28.0, 31.0, 29.0, 30.0, 32.0]
    for i, score in enumerate(flat):
        owner_conn.execute(
            'INSERT INTO "Score" (id, "userId", "computedAt", "scoreA", '
            '"sentinelScore", band, "confidenceLow", "confidenceHigh", "shapCategories") '
            "VALUES (%s, %s, now() - make_interval(days => %s), %s, %s, "
            "'MODERATE'::\"RiskBand\", 0, 100, '{}'::jsonb)",
            (f"fl-{cohort.quiet}-{i}", cohort.quiet, len(flat) - i, score / 100.0, score),
        )

    decision = escalation.evaluate(cohort.quiet, "MODERATE", scoring_conn)

    assert decision.escalated is False

    owner_conn.execute('DELETE FROM "Score" WHERE "userId" = %s', (cohort.quiet,))


def test_trend_detection_reads_only_aggregates_not_individual_scores(scoring_conn):
    """The scoring role stays write-only with respect to Score rows.

    It learns two rolling means; it cannot read anyone's score history.
    """
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        scoring_conn.execute('SELECT "sentinelScore" FROM "Score" LIMIT 1').fetchall()

    row = scoring_conn.execute(
        "SELECT n_scores, recent_mean, prior_mean FROM sentinel_score_trend(%s, 3)",
        ("syn-000000",),
    ).fetchone()
    assert row is not None
