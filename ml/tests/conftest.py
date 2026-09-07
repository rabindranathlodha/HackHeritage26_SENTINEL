"""Shared test fixtures.

Database fixtures build their own rows and tear them down. These are test
fixtures, not demo data: nothing here is ever served by an API or shown in a
demo. All production/demo data comes from the synthetic pipeline (spec 6).
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

OWNER_DSN = os.environ.get(
    "DATABASE_URL", "postgresql://sentinel:sentinel@db:5432/sentinel"
)
APP_DSN = os.environ.get("SENTINEL_APP_DATABASE_URL")


requires_db = pytest.mark.skipif(
    not APP_DSN, reason="SENTINEL_APP_DATABASE_URL not configured"
)


@pytest.fixture(scope="session", autouse=True)
def _load_model_artifacts():
    """Mirror the service's startup lifespan.

    A bare TestClient does not run lifespan events, so without this the tests
    would exercise an unloaded service and every prediction would 503.
    """
    from app.models import model_a, model_b, model_c

    model_a.load()
    model_b.load()
    model_c.load()


@pytest.fixture(scope="session")
def owner_conn():
    """Owner connection: schema/seed work only. Bypasses RLS by design."""
    with psycopg.connect(OWNER_DSN, autocommit=True) as conn:
        # Fail fast rather than hang if a test leaves a lock held: a blocked
        # teardown is indistinguishable from a hung suite otherwise.
        conn.execute("SET lock_timeout = '15s'")
        yield conn


@pytest.fixture()
def app_conn():
    """Request-path connection. Holds no privileges until it SET ROLEs."""
    with psycopg.connect(APP_DSN, autocommit=False) as conn:
        yield conn
        conn.rollback()


class Cohort:
    """Ids of the fixture rows, so tests can refer to them by meaning."""

    def __init__(self, tag: str):
        self.tag = tag
        self.unit = f"UNIT-{tag}"
        self.commander = f"cmd-{tag}"
        self.officer = f"off-{tag}"
        self.other_officer = f"off2-{tag}"
        self.alerted = f"p-alerted-{tag}"  # assigned to officer, has active alert
        self.quiet = f"p-quiet-{tag}"  # assigned to officer, no alert
        self.unassigned = f"p-other-{tag}"  # assigned to a different officer


@pytest.fixture()
def cohort(owner_conn):
    """A small unit: one commander, two officers, three personnel."""
    c = Cohort(uuid.uuid4().hex[:8])
    users = [
        (c.commander, "COMMANDER", c.unit, None),
        (c.officer, "WELFARE_OFFICER", c.unit, None),
        (c.other_officer, "WELFARE_OFFICER", c.unit, None),
        (c.alerted, "PERSONNEL", c.unit, c.officer),
        (c.quiet, "PERSONNEL", c.unit, c.officer),
        (c.unassigned, "PERSONNEL", c.unit, c.other_officer),
    ]
    with owner_conn.cursor() as cur:
        for uid, role, unit, officer in users:
            cur.execute(
                'INSERT INTO "User" (id, role, "unitId", "welfareOfficerId") '
                "VALUES (%s, %s::\"Role\", %s, %s)",
                (uid, role, unit, officer),
            )
        for person in (c.alerted, c.quiet, c.unassigned):
            cur.execute(
                'INSERT INTO "Score" (id, "userId", "scoreA", "sentinelScore", band, '
                '"confidenceLow", "confidenceHigh", "shapCategories") '
                "VALUES (%s, %s, 0.4, 42.0, 'MODERATE'::\"RiskBand\", 0.35, 0.5, '{}'::jsonb)",
                (f"s-{person}", person),
            )
            # An opaque blob: the column holds AES-256-GCM ciphertext, and the
            # fixture has no business knowing the key.
            cur.execute(
                'INSERT INTO "Assessment" (id, "userId", "responsesEnc") '
                "VALUES (%s, %s, decode(repeat('ab', 48), 'hex'))",
                (f"a-{person}", person),
            )
        # Only the alerted person has an open alert.
        cur.execute(
            'INSERT INTO "Alert" (id, "userId", band) '
            "VALUES (%s, %s, 'ELEVATED'::\"RiskBand\")",
            (f"al-{c.alerted}", c.alerted),
        )
    yield c
    with owner_conn.cursor() as cur:
        ids = tuple(u[0] for u in users)
        cur.execute('DELETE FROM "AuditLog" WHERE "actorId" = ANY(%s)', (list(ids),))
        cur.execute('DELETE FROM "Alert" WHERE "userId" = ANY(%s)', (list(ids),))
        cur.execute('DELETE FROM "Assessment" WHERE "userId" = ANY(%s)', (list(ids),))
        cur.execute('DELETE FROM "Score" WHERE "userId" = ANY(%s)', (list(ids),))
        cur.execute('DELETE FROM "HrSignal" WHERE "userId" = ANY(%s)', (list(ids),))
        cur.execute('DELETE FROM "User" WHERE id = ANY(%s)', (list(ids),))


def act_as(conn, db_role: str, user_id: str) -> None:
    """Enter the request-path context: one role, one identity, this transaction."""
    conn.execute(f"SET LOCAL ROLE {db_role}")
    conn.execute("SELECT set_config('sentinel.user_id', %s, true)", (user_id,))
