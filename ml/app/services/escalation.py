"""Escalation engine (spec Section 8)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

import psycopg

from app.config import RiskBand
from app.db import scoring_connection

logger = logging.getLogger("sentinel.escalation")

ALERT_QUEUE_KEY = "sentinel:alerts:pending"

REASON_PRIORITY_BAND = "band_priority_review"
REASON_SUSTAINED_TREND = "sustained_upward_trend"


@dataclass(frozen=True)
class EscalationDecision:
    """What the engine decided, and why. Returned for the audit trail."""

    escalated: bool
    reasons: list[str] = field(default_factory=list)
    alert_id: str | None = None
    already_open: bool = False
    trend: dict | None = None

    def to_dict(self) -> dict:
        return {
            "escalated": self.escalated,
            "reasons": self.reasons,
            "alert_id": self.alert_id,
            "already_open": self.already_open,
            "trend": self.trend,
            # Stated in the payload so a dashboard cannot imply otherwise.
            "action_taken": "none",
            "awaiting": "welfare_officer_review",
        }


def _trend(conn, user_id: str, window: int) -> dict:
    """Rolling mean of the last `window` scores against the `window` before it.

    Reads only two means and a count — never the individual rows — so the
    scoring role stays write-only with respect to Score.
    """
    row = conn.execute(
        "SELECT n_scores, recent_mean, prior_mean FROM sentinel_score_trend(%s, %s)",
        (user_id, window),
    ).fetchone()
    n_scores, recent_mean, prior_mean = row
    return {
        "n_scores": int(n_scores or 0),
        "recent_mean": float(recent_mean) if recent_mean is not None else None,
        "prior_mean": float(prior_mean) if prior_mean is not None else None,
    }


def _config(conn) -> tuple[float, int]:
    """Read the trend thresholds through the definer function.

    Not a direct table read: the scoring role has no business holding SELECT on
    PrivacyConfig, and the function keeps that true.
    """
    row = conn.execute(
        'SELECT "trendDelta", "trendWindow" FROM sentinel_trend_config()'
    ).fetchone()
    return float(row[0]), int(row[1])


def evaluate(user_id: str, band: RiskBand | str, conn=None) -> EscalationDecision:
    """Decide whether this person's score warrants a human looking at it."""
    if conn is None:
        with scoring_connection() as own:
            decision = evaluate(user_id, band, own)
            own.commit()
            return decision

    band_value = band.value if isinstance(band, RiskBand) else str(band)
    delta_threshold, window = _config(conn)

    reasons: list[str] = []
    if band_value == RiskBand.PRIORITY_REVIEW.value:
        reasons.append(REASON_PRIORITY_BAND)

    # Spec 8: a sustained negative trend escalates even below the top band.
    # This is the second net under Model A's conservative PRIORITY_REVIEW recall
    # (0.429, measured at step 3.5) — a person whose scores are climbing gets a
    # human look before they reach the top band.
    trend = _trend(conn, user_id, window)
    if (
        trend["n_scores"] >= window * 2
        and trend["recent_mean"] is not None
        and trend["prior_mean"] is not None
        and (trend["recent_mean"] - trend["prior_mean"]) >= delta_threshold
    ):
        reasons.append(REASON_SUSTAINED_TREND)

    if not reasons:
        return EscalationDecision(escalated=False, trend=trend)

    alert_id = f"al-{os.urandom(12).hex()}"
    try:
        # A conflict means an officer already has this person queued, which is
        # normal. Nested so it rolls back only this INSERT — a bare rollback()
        # would discard the caller's in-flight work.
        with conn.transaction():
            conn.execute(
                'INSERT INTO "Alert" (id, "userId", band, status) '
                "VALUES (%s, %s, %s::\"RiskBand\", 'PENDING_REVIEW')",
                (alert_id, user_id, band_value),
            )
    except psycopg.errors.UniqueViolation:
        logger.info("alert already open for this person; not duplicating")
        return EscalationDecision(
            escalated=False, reasons=reasons, already_open=True, trend=trend
        )

    _enqueue(alert_id)
    logger.info("alert %s created PENDING_REVIEW (%s)", alert_id, ", ".join(reasons))
    return EscalationDecision(
        escalated=True, reasons=reasons, alert_id=alert_id, trend=trend
    )


def _enqueue(alert_id: str) -> None:
    """Put the alert id on the officer's work queue.

    A queue an officer pulls from — not a channel that pushes at anyone. If
    Redis is unavailable the alert row still exists in Postgres, which is the
    system of record; the queue is an index over it, never the only copy.
    """
    url = os.environ.get("REDIS_URL")
    if not url:
        return
    try:
        import redis

        redis.Redis.from_url(url).lpush(ALERT_QUEUE_KEY, alert_id)
    except Exception as exc:  # noqa: BLE001 - queueing must never fail scoring
        logger.warning("could not enqueue alert %s: %s", alert_id, exc)
