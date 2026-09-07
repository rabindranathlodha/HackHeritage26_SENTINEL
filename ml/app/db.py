"""Database access for the ML service.

The service connects as `sentinel_app`, which holds no privileges of its own,
and enters the `sentinel_scoring` role for the duration of a transaction. That
role can read HR signals and write scores but can NEVER read an individual
Score, Assessment or Alert row — the scoring path is write-only with respect to
welfare content, so a bug here cannot turn into a data leak.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import pandas as pd
import psycopg

SCORING_ROLE = "sentinel_scoring"
COHORT_ROLE = "sentinel_commander"

# Maps HrSignal's camelCase columns onto the feature pipeline's names, so the
# pipeline sees identical inputs whether they came from Postgres or parquet.
_HR_SIGNAL_QUERY = """
SELECT "date"                   AS date,
       "leaveRequested"         AS leave_requested,
       "leaveApproved"          AS leave_approved,
       "leaveDenied"            AS leave_denied,
       "deploymentDays"         AS deployment_days,
       "daysSinceHomePosting"   AS days_since_home_posting,
       "remoteHazardous"        AS remote_hazardous,
       "transfersTrailing12mo"  AS transfers_trailing_12mo,
       "shiftStartStdDev"       AS shift_start_std_dev,
       "nightShiftRatio"        AS night_shift_ratio,
       "consecutiveDutyDays"    AS consecutive_duty_days,
       "trainingHoursVsAvg"     AS training_hours_vs_avg,
       "daysSinceIncident"      AS days_since_incident
FROM "HrSignal"
WHERE "userId" = %s
ORDER BY "date"
"""


def dsn() -> str | None:
    return os.environ.get("SENTINEL_APP_DATABASE_URL")


@contextmanager
def scoring_connection() -> Iterator[psycopg.Connection]:
    """A transaction scoped to the least-privilege scoring role."""
    url = dsn()
    if not url:
        raise RuntimeError("SENTINEL_APP_DATABASE_URL is not configured")
    with psycopg.connect(url) as conn:
        conn.execute(f"SET LOCAL ROLE {SCORING_ROLE}")
        yield conn


@contextmanager
def cohort_connection() -> Iterator[psycopg.Connection]:
    """A transaction scoped to the commander role, for aggregates only.

    This role has no SELECT on Score, Assessment, Alert or HrSignal. Everything
    it can reach comes through the k-anonymised summary function, so an
    aggregate endpoint cannot become an individual-row leak.
    """
    url = dsn()
    if not url:
        raise RuntimeError("SENTINEL_APP_DATABASE_URL is not configured")
    with psycopg.connect(url) as conn:
        conn.execute(f"SET LOCAL ROLE {COHORT_ROLE}")
        yield conn


def load_hr_history(user_id: str) -> pd.DataFrame:
    """Read one person's daily HR-signal history."""
    with scoring_connection() as conn, conn.cursor() as cur:
        cur.execute(_HR_SIGNAL_QUERY, (user_id,))
        columns = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=columns)
