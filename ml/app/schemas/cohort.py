"""Schemas for the cohort aggregate and escalation endpoints.

Neither is part of the spec Section 5 contract. They implement Sections 8 and 9,
which the spec describes as layers rather than endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CohortSummaryRequest(BaseModel):
    """Filters for a cohort aggregate.

    Note what is absent: there is no parameter that relaxes the k-anonymity
    threshold. Adding one would mean changing the SQL function, not this class.
    """

    unit_id: str | None = None
    band: str | None = None


class EscalationRequest(BaseModel):
    user_id: str
    band: str


class EscalationResponse(BaseModel):
    escalated: bool
    reasons: list[str] = Field(default_factory=list)
    alert_id: str | None = None
    already_open: bool = False
    trend: dict | None = None
    # Stated explicitly so no consumer can imply the system acted on its own.
    action_taken: str
    awaiting: str
