"""k-anonymity for cohort aggregates (spec 9.1)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.db import scoring_connection

REFUSAL_REASON = "cohort_below_k_anonymity_threshold"


@dataclass(frozen=True)
class CohortSummary:
    """One cohort's aggregate figures, or a refusal."""

    unit_id: str
    refused: bool
    n: int | None
    band_counts: dict[str, int] | None
    mean_score: float | None

    def to_dict(self, k: int) -> dict[str, Any]:
        if self.refused:
            # Spec 9.1: a refusal object, never partial or rounded data.
            return {
                "unit_id": self.unit_id,
                "refused": True,
                "reason": REFUSAL_REASON,
                "k": k,
            }
        return {
            "unit_id": self.unit_id,
            "refused": False,
            "n": self.n,
            "band_counts": self.band_counts,
            "mean_score": self.mean_score,
        }


def k_threshold(conn=None) -> int:
    """The threshold actually in force, read from the database."""
    if conn is not None:
        return int(conn.execute("SELECT sentinel_k_threshold()").fetchone()[0])
    with scoring_connection() as own:
        return int(own.execute("SELECT sentinel_k_threshold()").fetchone()[0])


def cohort_summary(
    conn, unit_id: str | None = None, band: str | None = None
) -> list[dict[str, Any]]:
    """Aggregate welfare-risk figures per unit, suppressed below k.

    `conn` must already be acting as a role permitted to call the function —
    only `sentinel_commander` is granted EXECUTE. There is deliberately no
    `include_small_cohorts` argument, and adding one would require changing the
    SQL function, not this file.
    """
    k = k_threshold(conn)
    rows = conn.execute(
        "SELECT unit_id, refused, n, low_count, moderate_count, elevated_count, "
        "priority_count, mean_score FROM sentinel_cohort_summary(%s, %s)",
        (unit_id, band),
    ).fetchall()

    summaries = []
    for unit, refused, n, low, moderate, elevated, priority, mean_score in rows:
        summaries.append(
            CohortSummary(
                unit_id=unit,
                refused=bool(refused),
                n=int(n) if n is not None else None,
                band_counts=None if refused else {
                    "LOW": int(low),
                    "MODERATE": int(moderate),
                    "ELEVATED": int(elevated),
                    "PRIORITY_REVIEW": int(priority),
                },
                mean_score=float(mean_score) if mean_score is not None else None,
            ).to_dict(k)
        )
    return summaries
